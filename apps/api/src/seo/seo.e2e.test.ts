import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { AnomalyRepository, ChannelRepository, createDatabase, FeatureFlagRepository, PostgresAnalyticsStore } from '@tga/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { CHANNEL_PAGE_FLAG, ChannelReader } from '../channels/channel-reader';
import { SEO_INDEXING_FLAG, SeoReader } from './seo-reader';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const flags = new FeatureFlagRepository(db);
const channels = new ChannelRepository(db);
const store = new PostgresAnalyticsStore(db);
const anomalies = new AnomalyRepository(db);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date('2026-09-20T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const policy = { minMembers: 1_000n, minHistoryDays: 7, maxAgeMs: 12 * HOUR };
let app: INestApplication;
let seq = 80_000n;

beforeAll(async () => {
  const seoReader = new SeoReader({ channels, flags, policy, now: () => now, flagCacheMs: 0 });
  const channelReader = new ChannelReader({
    channels,
    flags,
    store,
    anomalies,
    intervals: { metricsMs: 6 * HOUR, metadataMs: DAY },
    now: () => now,
    flagCacheMs: 0,
    indexable: (id) => seoReader.channelIndexable(id),
  });
  app = await createApp({ channelReader, seoReader });
  await app.init();
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE metric_anomalies RESTART IDENTITY CASCADE');
  await db.$executeRawUnsafe('DELETE FROM channel_metric_snapshots');
  await db.$executeRawUnsafe('TRUNCATE channel_aliases, channels, feature_flags RESTART IDENTITY CASCADE');
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/** A channel that satisfies every rule unless an override breaks one. */
async function candidate(username: string, o: Partial<{ members: bigint; currentAgeMs: number; historyDays: number; status: string; hidden: boolean; collection: string }> = {}) {
  seq += 1n;
  const currentAt = ago(o.currentAgeMs ?? HOUR);
  const c = await db.channel.create({
    data: {
      telegramId: seq,
      type: 'channel',
      username,
      title: username,
      memberCount: o.members ?? 5_000n,
      memberCountObservedAt: currentAt,
      collectionStatus: o.collection ?? 'ok',
      status: o.status ?? 'active',
      hiddenAt: o.hidden ? now : null,
    },
  });
  await store.appendChannelSnapshots([
    { entityId: c.id, metric: 'members', value: 4_000n, observedAt: ago((o.historyDays ?? 8) * DAY), source: 'bot_api' },
    { entityId: c.id, metric: 'members', value: o.members ?? 5_000n, observedAt: currentAt, source: 'bot_api' },
  ]);
  return c;
}

const get = (path: string) => request(app.getHttpServer()).get(path);

describe('indexation rule (OD-008 thresholds as configuration)', () => {
  it('is never indexable while seo.indexing is off, even when every rule passes', async () => {
    const c = await candidate('good_one');
    expect(await channels.isIndexable(c.id, policy, now)).toBe(true);
    const settings = await get('/api/v1/seo/settings');
    expect(settings.body.data).toEqual({ indexing: false, policy: { minMembers: '1000', minHistoryDays: 7, maxAgeHours: 12 } });
    expect((await get('/api/v1/seo/channels')).body.data).toEqual([]);
    await flags.set(CHANNEL_PAGE_FLAG, true);
    expect((await get('/api/v1/channels/good_one')).body.data.seo).toEqual({ indexable: false });
  });

  it.each([
    ['below the member minimum', { members: 999n }],
    ['stale current count', { currentAgeMs: 13 * HOUR }],
    ['too little history', { historyDays: 6 }],
    ['not active', { status: 'inaccessible' }],
    ['hidden by moderation', { hidden: true }],
    ['failing collection', { collection: 'failed' }],
  ])('excludes a channel %s', async (_label, override) => {
    await flags.set(SEO_INDEXING_FLAG, true);
    await candidate('control_ok');
    const c = await candidate('broken_one', override);
    expect(await channels.isIndexable(c.id, policy, now)).toBe(false);
    expect((await get('/api/v1/seo/channels')).body.data.map((i: { username: string }) => i.username)).toEqual(['control_ok']);
  });

  it('excludes a channel whose current count is flagged anomalous', async () => {
    await flags.set(SEO_INDEXING_FLAG, true);
    const c = await candidate('spiky_one');
    await anomalies.record(c.id, 'members', ago(HOUR), [{ rule: 'large_increase', previousValue: 4_000n, value: 5_000n, relativeChange: 0.25 }]);
    expect(await channels.isIndexable(c.id, policy, now)).toBe(false);
  });

  it('agrees between the channel view and the sitemap, with lastModified from the observation', async () => {
    await flags.set(SEO_INDEXING_FLAG, true);
    await flags.set(CHANNEL_PAGE_FLAG, true);
    await candidate('good_two');
    await candidate('small_one', { members: 10n });
    expect((await get('/api/v1/channels/good_two')).body.data.seo).toEqual({ indexable: true });
    expect((await get('/api/v1/channels/small_one')).body.data.seo).toEqual({ indexable: false });
    const sitemap = await get('/api/v1/seo/channels');
    expect(sitemap.body.data).toEqual([{ username: 'good_two', lastModified: ago(HOUR).toISOString() }]);
  });

  it('pages the sitemap source with bounded, validated parameters', async () => {
    await flags.set(SEO_INDEXING_FLAG, true);
    for (let i = 0; i < 5; i += 1) await candidate(`page_${i}`);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`/api/v1/seo/channels?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((i: { username: string }) => i.username));
      cursor = res.body.page.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual(['page_0', 'page_1', 'page_2', 'page_3', 'page_4']);
    expect((await get('/api/v1/seo/channels?limit=5001')).status).toBe(400);
    expect((await get('/api/v1/seo/channels?cursor=%27--')).status).toBe(400);
  });
});
