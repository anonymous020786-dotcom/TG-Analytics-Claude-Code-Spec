import { type Observed, TelegramError, type TelegramEntity } from '@tga/adapter-telegram';
import { ChannelRepository, createDatabase, JobRepository } from '@tga/database';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EntitySource, refreshMetadata } from './refresh-metadata';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const channels = new ChannelRepository(db);
const jobs = new JobRepository(db);

const t0 = new Date('2026-09-29T00:00:00Z');
const t1 = new Date('2026-09-29T06:00:00Z');
const base: TelegramEntity = { telegramId: -1001005640892n, type: 'channel', username: 'telegram', activeUsernames: ['telegram'], title: 'Telegram News', description: null };

const source = (...results: (TelegramEntity | Error)[]): EntitySource => ({
  resolvePublicEntity: vi.fn(async (): Promise<Observed<TelegramEntity>> => {
    const next = results.shift();
    if (!next) throw new Error('unexpected call');
    if (next instanceof Error) throw next;
    return { value: next, observedAt: t1, source: 'bot_api' };
  }),
});

async function seed() {
  return (await channels.upsertFromTelegram({ ...base, observedAt: t0 })).channel;
}

beforeEach(() => db.$executeRawUnsafe('TRUNCATE jobs, channel_aliases, channels RESTART IDENTITY CASCADE'));
afterAll(() => db.$disconnect());

describe('refreshMetadata', () => {
  it('updates metadata for the same Telegram entity', async () => {
    const c = await seed();
    const res = await refreshMetadata({ channels, telegram: source({ ...base, title: 'Telegram News (new)', description: 'd' }) }, c.id);
    expect(res.channel).toMatchObject({ id: c.id, title: 'Telegram News (new)', description: 'd', metadataObservedAt: t1 });
  });

  it('refuses to merge when the username now belongs to a different entity', async () => {
    const c = await seed();
    const other = { ...base, telegramId: -1009999999999n, title: 'Impostor' };
    await expect(refreshMetadata({ channels, telegram: source(other) }, c.id)).rejects.toMatchObject({ code: 'username_reassigned', failureClass: 'permanent' });
    expect(await channels.findById(c.id)).toMatchObject({ status: 'inaccessible', title: 'Telegram News' });
    expect(await db.channel.count()).toBe(1);
  });

  it('marks not_public entities and records the failed collection', async () => {
    const c = await seed();
    const priv = new TelegramError('permanent', 'not_public', 'x');
    await expect(refreshMetadata({ channels, telegram: source(priv) }, c.id)).rejects.toBe(priv);
    expect(await channels.findById(c.id)).toMatchObject({ status: 'not_public', collectionStatus: 'failed' });
  });

  it('schedules one search reindex per metadata version (idempotent on retry)', async () => {
    const c = await seed();
    await refreshMetadata({ channels, telegram: source({ ...base, title: 'Renamed' }), jobs }, c.id);
    await refreshMetadata({ channels, telegram: source({ ...base, title: 'Renamed' }), jobs }, c.id);
    const queued = await db.job.findMany({ where: { queue: 'search.index' } });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entityId: c.id, idempotencyKey: `metadata:${c.id}:${t1.toISOString()}` });
  });

  it('does not reindex when the observation is stale', async () => {
    const c = await seed();
    await channels.upsertFromTelegram({ ...base, title: 'Newer', observedAt: new Date(t1.getTime() + 60_000) });
    await refreshMetadata({ channels, telegram: source(base), jobs }, c.id);
    expect(await db.job.count({ where: { queue: 'search.index' } })).toBe(0);
  });
});
