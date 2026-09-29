import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelRepository, type TelegramEntityInput } from '../src';
import { resetTables, testDb } from './helpers';

const db = testDb();
const channels = new ChannelRepository(db);

beforeEach(() => resetTables(db));
afterAll(() => db.$disconnect());

const t = (day: number) => new Date(Date.UTC(2026, 8, day));
const entity = (overrides: Partial<TelegramEntityInput> = {}): TelegramEntityInput => ({
  telegramId: -1001005640892n,
  type: 'channel',
  username: 'telegram',
  title: 'Telegram News',
  description: null,
  observedAt: t(1),
  ...overrides,
});

describe('ChannelRepository.upsertFromTelegram', () => {
  it('creates a channel and its first alias', async () => {
    const res = await channels.upsertFromTelegram(entity());

    expect(res).toMatchObject({ created: true, previousUsername: null, stale: false });
    expect(res.channel).toMatchObject({ telegramId: -1001005640892n, username: 'telegram', status: 'active', type: 'channel' });
    expect(await db.channelAlias.count({ where: { channelId: res.channel.id } })).toBe(1);
  });

  it('is idempotent: rediscovery updates the same row, no duplicates', async () => {
    const a = await channels.upsertFromTelegram(entity());
    const b = await channels.upsertFromTelegram(entity({ title: 'Telegram News (updated)', observedAt: t(2) }));

    expect(b.created).toBe(false);
    expect(b.channel.id).toBe(a.channel.id);
    expect(b.channel.title).toBe('Telegram News (updated)');
    expect(await db.channel.count()).toBe(1);
    expect(await db.channelAlias.count()).toBe(1);
  });

  it('treats a username change as an alias, not a new channel', async () => {
    const a = await channels.upsertFromTelegram(entity({ username: 'oldname', observedAt: t(1) }));
    const b = await channels.upsertFromTelegram(entity({ username: 'NewName', observedAt: t(5) }));

    expect(b.channel.id).toBe(a.channel.id);
    expect(b.previousUsername).toBe('oldname');
    expect(b.channel.username).toBe('newname');
    expect((await channels.findByUsername('oldname'))?.id).toBe(a.channel.id);
    const aliases = await db.channelAlias.findMany({ where: { channelId: a.channel.id }, orderBy: { firstSeenAt: 'asc' } });
    expect(aliases.map((x) => x.username)).toEqual(['oldname', 'newname']);
  });

  it('releases a stale holder when a username changes hands', async () => {
    const first = await channels.upsertFromTelegram(entity({ telegramId: -1001n, username: 'shared_name' }));
    const second = await channels.upsertFromTelegram(entity({ telegramId: -1002n, username: 'shared_name', observedAt: t(3) }));

    expect(second.created).toBe(true);
    expect((await channels.findById(first.channel.id))?.username).toBeNull();
    expect((await channels.findByUsername('shared_name'))?.id).toBe(second.channel.id);
    // The first channel keeps the username in its alias history.
    expect(await db.channelAlias.count({ where: { channelId: first.channel.id, username: 'shared_name' } })).toBe(1);
  });

  it('never overwrites newer metadata with an older observation', async () => {
    await channels.upsertFromTelegram(entity({ title: 'Newer', observedAt: t(10) }));
    const res = await channels.upsertFromTelegram(entity({ title: 'Older', username: 'oldhandle', observedAt: t(2) }));

    expect(res.stale).toBe(true);
    expect(res.channel.title).toBe('Newer');
    expect(res.channel.username).toBe('telegram');
    // The older username is still recorded as history with its observation time.
    const alias = await db.channelAlias.findFirstOrThrow({ where: { username: 'oldhandle' } });
    expect(alias.firstSeenAt).toEqual(t(2));
  });

  it('widens alias first/last seen as observations arrive in any order', async () => {
    const { channel } = await channels.upsertFromTelegram(entity({ observedAt: t(5) }));
    await channels.upsertFromTelegram(entity({ observedAt: t(9) }));
    await channels.upsertFromTelegram(entity({ observedAt: t(3) }));

    const alias = await db.channelAlias.findFirstOrThrow({ where: { channelId: channel.id } });
    expect([alias.firstSeenAt, alias.lastSeenAt]).toEqual([t(3), t(9)]);
  });

  it('converges concurrent discoveries of the same entity onto one row', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => channels.upsertFromTelegram(entity({ observedAt: t(1 + i) }))));

    expect(new Set(results.map((r) => r.channel.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.channel.count()).toBe(1);
  });

  it('updates verified/scam flags only when provided (Bot API does not report them)', async () => {
    await channels.upsertFromTelegram(entity({ isVerified: true, observedAt: t(1) }));
    const res = await channels.upsertFromTelegram(entity({ observedAt: t(2) }));
    expect(res.channel.isVerified).toBe(true);
  });

  it('marks status without losing history and reactivates on rediscovery', async () => {
    const { channel } = await channels.upsertFromTelegram(entity());
    await db.post.create({ data: { channelId: channel.id, telegramMessageId: 1n, postedAt: t(1) } });

    await channels.markStatus(channel.id, 'inaccessible');
    expect((await channels.findById(channel.id))?.status).toBe('inaccessible');
    expect(await db.post.count({ where: { channelId: channel.id } })).toBe(1);

    const back = await channels.upsertFromTelegram(entity({ observedAt: t(4) }));
    expect(back.channel.status).toBe('active');
  });

  it('stores groups as type "group"', async () => {
    const res = await channels.upsertFromTelegram(entity({ telegramId: -1001311056733n, type: 'group', username: 'bottalk', title: 'Bot Talk' }));
    expect(res.channel.type).toBe('group');
  });
});
