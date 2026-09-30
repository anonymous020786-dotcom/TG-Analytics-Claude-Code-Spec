import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AnomalyRepository, ChannelRepository, InvalidCursorError, InvalidSearchQueryError, PostgresSearchIndex } from '../src';
import { resetTables, testDb } from './helpers';

const db = testDb();
const index = new PostgresSearchIndex(db);
const channels = new ChannelRepository(db);
const anomalies = new AnomalyRepository(db);
const t = (h: number) => new Date(Date.UTC(2026, 8, 20, h));
let seq = 50_000n;

async function add(username: string, title: string, opts: { members?: bigint; type?: 'channel' | 'group'; description?: string; aliases?: string[] } = {}) {
  seq += 1n;
  const c = await db.channel.create({
    data: {
      telegramId: seq,
      type: opts.type ?? 'channel',
      username,
      title,
      description: opts.description ?? null,
      ...(opts.members === undefined ? {} : { memberCount: opts.members, memberCountObservedAt: t(10) }),
    },
  });
  await index.upsertChannel({ channelId: c.id, username, aliases: opts.aliases ?? [], title, description: opts.description ?? null, sourceVersion: c.updatedAt });
  return c;
}

const names = (hits: { username: string }[]) => hits.map((h) => h.username);

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE metric_anomalies RESTART IDENTITY CASCADE');
  await resetTables(db);
});
afterAll(() => db.$disconnect());

describe('PostgresSearchIndex.searchChannels (relevance)', () => {
  it('ranks exact username > username prefix > previous username > title prefix > similar title', async () => {
    await add('cryptonews_daily', 'Daily digest', { members: 10n });
    await add('crypto', 'Crypto', { members: 5n });
    await add('bitnews', 'Bitcoin headlines', { members: 7n, aliases: ['crypto_old'] });
    await add('market_watch', 'Crypto markets today', { members: 100n });
    await add('unrelated', 'Cooking recipes', { members: 1_000n });

    const page = await index.searchChannels({ q: 'crypto', sort: 'relevance' });
    // bitnews matches through its previous username (crypto_old), below direct hits.
    expect(names(page.items)).toEqual(['crypto', 'cryptonews_daily', 'market_watch', 'bitnews']);
    expect(names((await index.searchChannels({ q: 'crypto_old', sort: 'relevance' })).items)[0]).toBe('bitnews');
  });

  it('matches descriptions (keywords) and non-Latin titles', async () => {
    await add('ru_news', 'Новости дня', { description: 'Главные события' });
    await add('cooking', 'Kitchen', { description: 'Weekly sourdough bread recipes' });
    expect(names((await index.searchChannels({ q: 'новости', sort: 'relevance' })).items)).toEqual(['ru_news']);
    expect(names((await index.searchChannels({ q: 'sourdough', sort: 'relevance' })).items)).toEqual(['cooking']);
  });

  it('treats LIKE and SQL metacharacters as data', async () => {
    await add('real_deal', 'Half price', { members: 1n });
    await add('realxdeal', 'Other', { members: 1n });
    expect(names((await index.searchChannels({ q: 'real_d', sort: 'relevance' })).items)).toEqual(['real_deal']);
    expect((await index.searchChannels({ q: '%%', sort: 'relevance' })).items).toEqual([]);
    expect((await index.searchChannels({ q: "x'; drop table channels;--", sort: 'relevance' })).items).toEqual([]);
    expect(await db.channel.count()).toBe(2);
  });

  it('escapes the LIKE escape character itself and backslashes', async () => {
    await add('wow_chan', 'Wow! deals', { members: 1n });
    await add('slash_chan', String.raw`Back\slash`, { members: 1n });
    expect(names((await index.searchChannels({ q: 'wow!', sort: 'relevance' })).items)).toEqual(['wow_chan']);
    expect(names((await index.searchChannels({ q: String.raw`k\s`, sort: 'relevance' })).items)).toEqual(['slash_chan']);
    expect((await index.searchChannels({ q: String.raw`k\%`, sort: 'relevance' })).items).toEqual([]);
    expect((await index.searchChannels({ q: '!%', sort: 'relevance' })).items).toEqual([]);
  });

  it('falls back to typo-tolerant matching only when nothing matches literally', async () => {
    await add('telegram', 'Telegram', { members: 1n });
    await add('telegrammer', 'Other', { members: 1n });
    // Literal matches exist: no fuzzy results mixed in.
    expect(names((await index.searchChannels({ q: 'telegramm', sort: 'relevance' })).items)).toEqual(['telegrammer']);
    // No literal match: similar names are found (4+ characters only).
    expect(names((await index.searchChannels({ q: 'telegramx', sort: 'relevance' })).items)).toEqual(['telegram', 'telegrammer']);
    expect(names(await index.suggestChannels('telegramx'))).toContain('telegram');
    expect((await index.searchChannels({ q: 'tgx', sort: 'relevance' })).items).toEqual([]);
  });

  it('walks every match exactly once with cursors (ties broken by id)', async () => {
    for (let i = 0; i < 23; i += 1) await add(`tech_${String(i).padStart(2, '0')}`, 'Tech', { members: BigInt(i) });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await index.searchChannels({ q: 'tech', sort: 'relevance', limit: 5, ...(cursor ? { cursor } : {}) });
      expect(page.items.length).toBeLessThanOrEqual(5);
      seen.push(...names(page.items));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
  });

  it('requires a valid query for relevance and rejects foreign or malformed cursors', async () => {
    await expect(index.searchChannels({ sort: 'relevance' })).rejects.toBeInstanceOf(InvalidSearchQueryError);
    await expect(index.searchChannels({ q: 'a', sort: 'relevance' })).rejects.toBeInstanceOf(InvalidSearchQueryError);
    const membersCursor = Buffer.from(JSON.stringify({ m: '5', id: '01000000-0000-7000-8000-000000000000' })).toString('base64url');
    await expect(index.searchChannels({ q: 'tech', sort: 'relevance', cursor: membersCursor })).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(index.searchChannels({ q: 'tech', sort: 'relevance', cursor: '!!' })).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe('PostgresSearchIndex.searchChannels (members sort and filters)', () => {
  it('browses by member count, with type and member-range filters, capped page size', async () => {
    await add('big_group', 'Big', { members: 5_000n, type: 'group' });
    await add('mid_chan', 'Mid', { members: 1_000n });
    await add('small_chan', 'Small', { members: 10n });
    await add('pending_chan', 'No count yet');

    expect(names((await index.searchChannels({ sort: 'members' })).items)).toEqual(['big_group', 'mid_chan', 'small_chan']);
    expect(names((await index.searchChannels({ sort: 'members', filters: { type: 'channel' } })).items)).toEqual(['mid_chan', 'small_chan']);
    expect(names((await index.searchChannels({ sort: 'members', filters: { minMembers: 100n, maxMembers: 2_000n } })).items)).toEqual(['mid_chan']);
    expect(names((await index.searchChannels({ q: 'chan', sort: 'members' })).items)).toEqual(['mid_chan', 'small_chan']);
    expect((await index.searchChannels({ sort: 'members', limit: 10_000 })).items.length).toBeLessThanOrEqual(100);
    await expect(index.searchChannels({ sort: 'members', filters: { minMembers: -1n } })).rejects.toBeInstanceOf(InvalidSearchQueryError);
  });

  it('walks equal member counts exactly once and rejects out-of-range cursors', async () => {
    for (let i = 0; i < 12; i += 1) await add(`same_${String(i).padStart(2, '0')}`, 'Same', { members: 42n });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await index.searchChannels({ sort: 'members', limit: 5, ...(cursor ? { cursor } : {}) });
      seen.push(...names(page.items));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(12);
    expect(seen).toHaveLength(12);
    const huge = Buffer.from(JSON.stringify({ m: '9999999999999999999', id: '01000000-0000-7000-8000-000000000000' })).toString('base64url');
    await expect(index.searchChannels({ sort: 'members', cursor: huge })).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe('PostgresSearchIndex visibility and data quality', () => {
  it('never returns hidden, non-active or username-less channels even with a stale document', async () => {
    const hidden = await add('secret_one', 'Secret', { members: 1n });
    const gone = await add('secret_two', 'Secret', { members: 1n });
    await db.channel.update({ where: { id: hidden.id }, data: { hiddenAt: t(11) } });
    await channels.markStatus(gone.id, 'inaccessible');
    expect((await index.searchChannels({ q: 'secret', sort: 'relevance' })).items).toEqual([]);
    expect(await index.suggestChannels('secret')).toEqual([]);
    expect((await index.searchChannels({ sort: 'members' })).items).toEqual([]);
  });

  it('shows members as unavailable (null) when the current observation is anomalous', async () => {
    const c = await add('spiky', 'Spiky', { members: 0n });
    await anomalies.record(c.id, 'members', t(10), [{ rule: 'drop_to_zero', previousValue: 900n, value: 0n, relativeChange: -1 }]);
    const [hit] = (await index.searchChannels({ q: 'spiky', sort: 'relevance' })).items;
    expect(hit).toMatchObject({ username: 'spiky', members: null });
  });
});

describe('PostgresSearchIndex.upsertChannel / removeChannel', () => {
  it('is idempotent and never lets an older version overwrite a newer one', async () => {
    const c = await add('versioned', 'New title', { members: 1n });
    expect(await index.upsertChannel({ channelId: c.id, username: 'versioned', aliases: [], title: 'Old title', description: null, sourceVersion: new Date(c.updatedAt.getTime() - 1_000) })).toBe('stale');
    expect(await index.upsertChannel({ channelId: c.id, username: 'versioned', aliases: [], title: 'New title', description: null, sourceVersion: c.updatedAt })).toBe('indexed');
    const doc = await db.channelSearchDocument.findUniqueOrThrow({ where: { channelId: c.id } });
    expect(doc.title).toBe('new title');
    await index.removeChannel(c.id);
    await index.removeChannel(c.id);
    expect(await db.channelSearchDocument.count()).toBe(0);
  });

  it('bounds stored text and drops duplicate aliases', async () => {
    const c = await add('bounded', 'x'.repeat(512), { description: 'y'.repeat(5_000), aliases: ['bounded', 'old_one', 'old_one'] });
    const doc = await db.channelSearchDocument.findUniqueOrThrow({ where: { channelId: c.id } });
    expect(doc.title.length).toBe(512);
    expect(doc.description.length).toBe(1024);
    expect(doc.aliases).toBe('old_one');
  });
});

describe('PostgresSearchIndex.suggestChannels', () => {
  it('returns at most the requested number, best match first, then larger channels', async () => {
    await add('news_small', 'News', { members: 10n });
    await add('news_big', 'News', { members: 10_000n });
    await add('news', 'News', { members: 1n });
    const hits = await index.suggestChannels('news', 2);
    expect(names(hits)).toEqual(['news', 'news_big']);
    expect((await index.suggestChannels('news', 999)).length).toBe(3);
    await expect(index.suggestChannels('n')).rejects.toBeInstanceOf(InvalidSearchQueryError);
  });
});
