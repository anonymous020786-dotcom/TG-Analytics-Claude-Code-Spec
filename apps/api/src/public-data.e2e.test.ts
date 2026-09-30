import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { AnomalyRepository, ChannelRepository, createDatabase, FeatureFlagRepository, PostgresAnalyticsStore, RankingRepository } from '@tga/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { CHANNEL_PAGE_FLAG } from './channels/channel-reader';
import { RANKINGS_FLAG, RankingsReader } from './rankings/rankings-reader';
import { StatsReader } from './stats/stats-reader';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const flags = new FeatureFlagRepository(db);
const channels = new ChannelRepository(db);
const store = new PostgresAnalyticsStore(db);
const anomalies = new AnomalyRepository(db);
const rankings = new RankingRepository(db);

const DAY = 86_400_000;
const now = new Date('2026-09-20T12:00:00Z');
const at = (daysAgo: number, hour = 0) => new Date(Date.UTC(2026, 8, 20 - daysAgo, hour));
let app: INestApplication;
let seq = 70_000n;

beforeAll(async () => {
  app = await createApp({
    statsReader: new StatsReader({ channels, flags, store, anomalies, now: () => now, flagCacheMs: 0 }),
    rankingsReader: new RankingsReader({ rankings, channels, flags, flagCacheMs: 0 }),
  });
  await app.init();
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE metric_anomalies, ranking_snapshots, ranking_runs RESTART IDENTITY CASCADE');
  await db.$executeRawUnsafe('DELETE FROM channel_metric_snapshots');
  await db.$executeRawUnsafe('TRUNCATE channel_aliases, channels, feature_flags RESTART IDENTITY CASCADE');
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

async function channel(username: string, members?: bigint) {
  seq += 1n;
  return db.channel.create({
    data: { telegramId: seq, type: 'channel', username, title: username.toUpperCase(), ...(members === undefined ? {} : { memberCount: members, memberCountObservedAt: at(0) }) },
  });
}

const get = (path: string) => request(app.getHttpServer()).get(path);

describe('GET /api/v1/channels/:id/stats', () => {
  it('is 404 while the channel page flag is off', async () => {
    const c = await channel('stats_one');
    expect((await get(`/api/v1/channels/${c.id}/stats`)).status).toBe(404);
  });

  it('returns the last valid value per UTC day, excluding anomalies and never filling gaps', async () => {
    await flags.set(CHANNEL_PAGE_FLAG, true);
    const c = await channel('stats_two');
    await store.appendChannelSnapshots(
      (
        [
          [3, 6, 100n],
          [3, 18, 110n],
          [1, 6, 0n],
          [1, 12, 130n],
          [0, 6, 140n],
        ] as const
      ).map(([d, h, v]) => ({ entityId: c.id, metric: 'members', value: v, observedAt: at(d, h), source: 'bot_api' as const })),
    );
    await anomalies.record(c.id, 'members', at(1, 6), [{ rule: 'drop_to_zero', previousValue: 110n, value: 0n, relativeChange: -1 }]);

    const res = await get(`/api/v1/channels/${c.id}/stats?days=7`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.body.data).toMatchObject({ channelId: c.id, metric: 'members', days: 7, excludedAnomalies: 1 });
    expect(res.body.data.points).toEqual([
      { date: '2026-09-17', value: '110', observedAt: at(3, 18).toISOString() },
      { date: '2026-09-19', value: '130', observedAt: at(1, 12).toISOString() },
      { date: '2026-09-20', value: '140', observedAt: at(0, 6).toISOString() },
    ]);
  });

  it('bounds the window to the requested days', async () => {
    await flags.set(CHANNEL_PAGE_FLAG, true);
    const c = await channel('stats_three');
    await store.appendChannelSnapshots([
      { entityId: c.id, metric: 'members', value: 1n, observedAt: new Date(now.getTime() - 40 * DAY), source: 'bot_api' },
      { entityId: c.id, metric: 'members', value: 2n, observedAt: new Date(now.getTime() - 20 * DAY), source: 'bot_api' },
    ]);
    expect((await get(`/api/v1/channels/${c.id}/stats`)).body.data.points.map((p: { value: string }) => p.value)).toEqual(['2']);
    expect((await get(`/api/v1/channels/${c.id}/stats?days=90`)).body.data.points).toHaveLength(2);
  });

  it.each([
    ['non-uuid id', '/api/v1/channels/not-a-uuid/stats'],
    ['unsupported window', '/api/v1/channels/01000000-0000-7000-8000-000000000000/stats?days=14'],
    ['repeated days', '/api/v1/channels/01000000-0000-7000-8000-000000000000/stats?days=7&days=30'],
  ])('rejects %s with 400', async (_label, path) => {
    await flags.set(CHANNEL_PAGE_FLAG, true);
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_query');
  });

  it('is 404 for unknown and hidden channels', async () => {
    await flags.set(CHANNEL_PAGE_FLAG, true);
    const c = await channel('stats_hidden');
    await db.channel.update({ where: { id: c.id }, data: { hiddenAt: now } });
    expect((await get(`/api/v1/channels/${c.id}/stats`)).status).toBe(404);
    expect((await get('/api/v1/channels/01000000-0000-7000-8000-000000000000/stats')).status).toBe(404);
  });
});

describe('rankings and trending', () => {
  async function seedRun(key: string, version: string, ids: string[]) {
    await rankings.saveRun({ rankingKey: key, methodologyVersion: version, asOf: at(0), eligibleCount: ids.length, entries: ids.map((id, i) => ({ position: i + 1, channelId: id, score: 1000 - i })) });
  }

  it('is hidden (404) while rankings.public is off', async () => {
    for (const path of ['/api/v1/rankings', '/api/v1/rankings/top-subscribers', '/api/v1/trending']) expect((await get(path)).status).toBe(404);
  });

  it('lists every ranking with methodology and its latest run', async () => {
    await flags.set(RANKINGS_FLAG, true);
    const a = await channel('rank_a', 500n);
    await seedRun('top-subscribers', 'rank-members-v1', [a.id]);
    const res = await get('/api/v1/rankings');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { key: string }) => r.key)).toEqual(['top-subscribers', 'fastest-growing-7d', 'trending']);
    expect(res.body.data[0]).toMatchObject({ methodologyVersion: 'rank-members-v1', eligibility: { minBase: '0' }, latestRun: { eligibleCount: 1, entryCount: 1 } });
    expect(res.body.data[0].disclaimer).toMatch(/not an official Telegram ranking/);
    expect(res.body.data[2].latestRun).toBeNull();
  });

  it('pages entries with channel identity and skips entities hidden after the run', async () => {
    await flags.set(RANKINGS_FLAG, true);
    const [a, b, c] = [await channel('rank_a', 300n), await channel('rank_b', 200n), await channel('rank_c', 100n)];
    await seedRun('trending', 'trending-v1', [a.id, b.id, c.id]);
    await db.channel.update({ where: { id: b.id }, data: { hiddenAt: now } });

    const first = await get('/api/v1/trending?limit=2');
    expect(first.status).toBe(200);
    expect(first.body.data.ranking).toMatchObject({ key: 'trending', methodologyVersion: 'trending-v1' });
    expect(first.body.data.entries).toEqual([{ position: 1, score: 1000, channel: { id: a.id, username: 'rank_a', title: 'RANK_A', type: 'channel', members: { value: '300', observedAt: at(0).toISOString() } } }]);
    const next = await get(`/api/v1/rankings/trending?limit=2&cursor=${first.body.page.nextCursor}`);
    expect(next.body.data.entries.map((e: { position: number }) => e.position)).toEqual([3]);
    expect(next.body.page.nextCursor).toBeNull();
  });

  it('returns an empty list (not an error) before the first run, 404 for unknown rankings, 400 for bad input', async () => {
    await flags.set(RANKINGS_FLAG, true);
    const empty = await get('/api/v1/rankings/fastest-growing-7d');
    expect(empty.status).toBe(200);
    expect(empty.body.data).toMatchObject({ entries: [], ranking: { latestRun: null } });
    expect((await get('/api/v1/rankings/most-popular-ever')).status).toBe(404);
    expect((await get('/api/v1/rankings/trending?limit=0')).body.error.code).toBe('invalid_query');
    expect((await get('/api/v1/rankings/top-subscribers?cursor=%27--')).status).toBe(200); // no run yet: cursor unused
    const a = await channel('rank_z', 1n);
    await seedRun('top-subscribers', 'rank-members-v1', [a.id]);
    expect((await get('/api/v1/rankings/top-subscribers?cursor=%27--')).body.error.code).toBe('invalid_cursor');
  });
});

describe('GET /api/v1/methodology', () => {
  it('publishes every metric definition (FR-ANL-01) without a flag', async () => {
    const res = await get('/api/v1/methodology');
    expect(res.status).toBe(200);
    const keys = res.body.data.metrics.map((m: { key: string }) => m.key);
    expect(keys).toContain('members');
    expect(keys).toContain('members_growth_7d');
    for (const m of res.body.data.metrics) expect(m).toMatchObject({ calculation: expect.any(String), missingData: expect.any(String), methodologyVersion: expect.any(String) });
  });
});
