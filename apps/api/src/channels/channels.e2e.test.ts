import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { AnomalyRepository, ChannelRepository, createDatabase, FeatureFlagRepository, PostgresAnalyticsStore } from '@tga/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { CHANNEL_PAGE_FLAG, ChannelReader } from './channel-reader';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const channels = new ChannelRepository(db);
const flags = new FeatureFlagRepository(db);
const store = new PostgresAnalyticsStore(db);
const anomalies = new AnomalyRepository(db);

const DAY = 86_400_000;
const now = new Date('2026-09-20T12:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * DAY);
let app: INestApplication;

beforeAll(async () => {
  const reader = new ChannelReader({ channels, flags, store, anomalies, intervals: { metricsMs: 6 * 3_600_000, metadataMs: DAY }, now: () => now, flagCacheMs: 0 });
  app = await createApp({ channelReader: reader });
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

async function seed() {
  const { channel } = await channels.upsertFromTelegram({ telegramId: -1001005640892n, type: 'channel', username: 'telegram', title: 'Telegram News', description: 'News', observedAt: ago(0.1) });
  await store.appendChannelSnapshots(
    ([[7, 10_000n], [1, 11_000n], [0.1, 12_000n]] as const).map(([d, v]) => ({ entityId: channel.id, metric: 'members', value: v, observedAt: ago(d), source: 'bot_api' as const })),
  );
  await channels.recordMemberCount(channel.id, 12_000n, ago(0.1));
  return channel;
}

const get = (path: string) => request(app.getHttpServer()).get(path);

describe('GET /api/v1/channels/:username', () => {
  it('is hidden (404) while the feature flag is off, even for existing channels', async () => {
    await seed();
    const res = await get('/api/v1/channels/telegram');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'not_found' });
  });

  it('returns identity, members, growth, quality and a request id when enabled', async () => {
    const c = await seed();
    await flags.set(CHANNEL_PAGE_FLAG, true);
    const res = await get('/api/v1/channels/@Telegram').set('X-Request-Id', 'req-abcdef12');

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-abcdef12');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body.meta.requestId).toBe('req-abcdef12');
    expect(res.body.data).toMatchObject({
      id: c.id,
      username: 'telegram',
      requestedAlias: null,
      type: 'channel',
      title: 'Telegram News',
      members: { value: '12000', observedAt: ago(0.1).toISOString() },
      growth: {
        '1d': { available: true, absolute: '1000', methodologyVersion: 'growth-v1' },
        '7d': { available: true, absolute: '2000', percentage: 20 },
      },
      quality: { verdict: 'ok', members: { state: 'fresh' } },
    });
    expect(res.body.data.disclaimer).toMatch(/not official Telegram statistics/);
  });

  it('reports unavailable growth (never 0) when there is no baseline', async () => {
    await flags.set(CHANNEL_PAGE_FLAG, true);
    const { channel } = await channels.upsertFromTelegram({ telegramId: -1002n, type: 'group', username: 'newgroup', title: 'New', description: null, observedAt: ago(0.1) });
    await store.appendChannelSnapshots([{ entityId: channel.id, metric: 'members', value: 500n, observedAt: ago(0.1), source: 'bot_api' }]);
    const res = await get('/api/v1/channels/newgroup');
    expect(res.body.data.growth['7d']).toEqual({ available: false, reason: 'no_baseline', methodologyVersion: 'growth-v1' });
    expect(res.body.data.type).toBe('group');
  });

  it('never shows an anomalous value as the current member count', async () => {
    const c = await seed();
    await flags.set(CHANNEL_PAGE_FLAG, true);
    await store.appendChannelSnapshots([{ entityId: c.id, metric: 'members', value: 0n, observedAt: ago(0.05), source: 'bot_api' }]);
    await anomalies.record(c.id, 'members', ago(0.05), [{ rule: 'drop_to_zero', previousValue: 12_000n, value: 0n, relativeChange: -1 }]);
    expect((await get('/api/v1/channels/telegram')).body.data.members.value).toBe('12000');
  });

  it('resolves an old username (alias) and tells the client the current one', async () => {
    await seed();
    await flags.set(CHANNEL_PAGE_FLAG, true);
    await channels.upsertFromTelegram({ telegramId: -1001005640892n, type: 'channel', username: 'telegram_news', title: 'Telegram News', description: null, observedAt: ago(0.01) });
    const res = await get('/api/v1/channels/telegram');
    expect(res.body.data).toMatchObject({ username: 'telegram_news', requestedAlias: 'telegram' });
  });

  it('404s for unknown, hidden and non-active channels', async () => {
    const c = await seed();
    await flags.set(CHANNEL_PAGE_FLAG, true);
    expect((await get('/api/v1/channels/unknown_one')).status).toBe(404);
    await db.channel.update({ where: { id: c.id }, data: { hiddenAt: now } });
    expect((await get('/api/v1/channels/telegram')).status).toBe(404);
    await db.channel.update({ where: { id: c.id }, data: { hiddenAt: null, status: 'inaccessible' } });
    expect((await get('/api/v1/channels/telegram')).status).toBe(404);
  });

  it.each(['ab', '1abcde', 'bad name', "x'; drop table channels;--", 'a'.repeat(70)])('rejects invalid username %j with 400 and a stable error', async (bad) => {
    await flags.set(CHANNEL_PAGE_FLAG, true);
    const res = await get(`/api/v1/channels/${encodeURIComponent(bad)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'invalid_username' });
    expect(res.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
