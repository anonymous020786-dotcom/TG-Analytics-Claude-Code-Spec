import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { AnomalyRepository, ChannelRepository, createDatabase, FeatureFlagRepository, PostgresAnalyticsStore, PostgresSearchIndex } from '@tga/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { ChannelReader } from '../channels/channel-reader';
import { SEARCH_FLAG, SearchReader } from './search-reader';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const flags = new FeatureFlagRepository(db);
const index = new PostgresSearchIndex(db);
const observedAt = new Date('2026-09-20T10:00:00Z');
let app: INestApplication;
let seq = 90_000n;

beforeAll(async () => {
  const channelReader = new ChannelReader({
    channels: new ChannelRepository(db),
    flags,
    store: new PostgresAnalyticsStore(db),
    anomalies: new AnomalyRepository(db),
    intervals: { metricsMs: 3_600_000, metadataMs: 86_400_000 },
    flagCacheMs: 0,
  });
  app = await createApp({ channelReader, searchReader: new SearchReader({ index, flags, flagCacheMs: 0 }) });
  await app.init();
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE metric_anomalies, channel_aliases, channels, feature_flags RESTART IDENTITY CASCADE');
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

async function add(username: string, title: string, members: bigint | null, type: 'channel' | 'group' = 'channel') {
  seq += 1n;
  const c = await db.channel.create({
    data: { telegramId: seq, type, username, title, ...(members === null ? {} : { memberCount: members, memberCountObservedAt: observedAt }) },
  });
  await index.upsertChannel({ channelId: c.id, username, aliases: [], title, description: null, sourceVersion: c.updatedAt });
  return c;
}

const get = (path: string) => request(app.getHttpServer()).get(path);
const names = (body: { data: { username: string }[] }) => body.data.map((d) => d.username);

describe('flag', () => {
  it('hides search and suggest (404) while search.public is off, even for invalid input', async () => {
    await add('telegram', 'Telegram', 10n);
    for (const path of ['/api/v1/channels', '/api/v1/channels?q=tele', '/api/v1/channels?q=x', '/api/v1/search/suggest?q=tele']) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
  });
});

describe('GET /api/v1/channels', () => {
  beforeEach(() => flags.set(SEARCH_FLAG, true));

  it('searches by relevance with a stable envelope, request id and cache header', async () => {
    const c = await add('telegram', 'Telegram News', 12_000n);
    await add('telegram_tips', 'Tips', 50n, 'group');
    const res = await get('/api/v1/channels?q=%40Telegram').set('X-Request-Id', 'req-search01');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(res.body.meta.requestId).toBe('req-search01');
    expect(res.body.page).toEqual({ nextCursor: null, limit: 20 });
    expect(res.body.data[0]).toEqual({ id: c.id, username: 'telegram', title: 'Telegram News', type: 'channel', members: { value: '12000', observedAt: observedAt.toISOString() } });
    expect(names(res.body)).toEqual(['telegram', 'telegram_tips']);
  });

  it('browses by members with filters when no query is given', async () => {
    await add('big_group', 'Big', 5_000n, 'group');
    await add('mid_chan', 'Mid', 1_000n);
    await add('small_chan', 'Small', 10n);
    expect(names((await get('/api/v1/channels')).body)).toEqual(['big_group', 'mid_chan', 'small_chan']);
    expect(names((await get('/api/v1/channels?type=channel&minMembers=100')).body)).toEqual(['mid_chan']);
    expect(names((await get('/api/v1/channels?q=chan&sort=members')).body)).toEqual(['mid_chan', 'small_chan']);
  });

  it('walks every row exactly once through nextCursor', async () => {
    for (let i = 0; i < 7; i += 1) await add(`page_${i}`, 'Page', 100n);
    const seen: string[] = [];
    let path: string | null = '/api/v1/channels?q=page&limit=3';
    while (path) {
      const res = await get(path);
      expect(res.status).toBe(200);
      seen.push(...names(res.body));
      path = res.body.page.nextCursor ? `/api/v1/channels?q=page&limit=3&cursor=${res.body.page.nextCursor}` : null;
    }
    expect(seen.sort()).toEqual(Array.from({ length: 7 }, (_, i) => `page_${i}`));
  });

  it.each([
    ['q too short', '?q=a', 'invalid_query'],
    ['q too long', `?q=${'x'.repeat(65)}`, 'invalid_query'],
    ['relevance without q', '?sort=relevance', 'invalid_query'],
    ['unknown sort', '?sort=random', 'invalid_query'],
    ['unknown type', '?type=bot', 'invalid_query'],
    ['negative members', '?minMembers=-1', 'invalid_query'],
    ['non-numeric members', '?maxMembers=1e9', 'invalid_query'],
    ['min above max', '?minMembers=10&maxMembers=5', 'invalid_query'],
    ['limit above cap', '?limit=101', 'invalid_query'],
    ['limit zero', '?limit=0', 'invalid_query'],
    ['repeated parameter', '?q=aa&q=bb', 'invalid_query'],
    ['garbage cursor', '?cursor=%27%3B--', 'invalid_cursor'],
    ['oversized cursor', `?cursor=${'a'.repeat(513)}`, 'invalid_cursor'],
    ['cursor from another sort', `?q=tele&cursor=${Buffer.from(JSON.stringify({ m: '1', id: '01000000-0000-7000-8000-000000000000' })).toString('base64url')}`, 'invalid_cursor'],
  ])('rejects %s with 400', async (_label, qs, code) => {
    const res = await get(`/api/v1/channels${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it('ignores bracket (nested) parameters instead of parsing objects', async () => {
    const res = await get('/api/v1/channels?q[a]=bb&__proto__[x]=1');
    expect(res.status).toBe(200);
    expect(res.body.page.limit).toBe(20);
  });

  it('treats injection payloads as plain text (no DB error, no data loss)', async () => {
    await add('telegram', 'Telegram', 1n);
    for (const payload of ["' OR 1=1 --", '%_%', '\\\\', "x'); DROP TABLE channels; --"]) {
      const res = await get(`/api/v1/channels?q=${encodeURIComponent(payload)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    }
    expect(await db.channel.count()).toBe(1);
  });

  it('never lists hidden channels', async () => {
    const c = await add('hidden_one', 'Hidden', 1n);
    await db.channel.update({ where: { id: c.id }, data: { hiddenAt: observedAt } });
    expect((await get('/api/v1/channels?q=hidden')).body.data).toEqual([]);
    expect((await get('/api/v1/channels')).body.data).toEqual([]);
    expect((await get('/api/v1/search/suggest?q=hidden')).body.data).toEqual([]);
  });

  it('keeps GET /channels/:username working alongside the list route', async () => {
    const res = await get('/api/v1/channels/unknown_one');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/search/suggest', () => {
  beforeEach(() => flags.set(SEARCH_FLAG, true));

  it('returns bounded suggestions, best first', async () => {
    await add('news_big', 'News', 10_000n);
    await add('news', 'News', 1n);
    await add('news_small', 'News', 10n);
    const res = await get('/api/v1/search/suggest?q=news&limit=2');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['news', 'news_big']);
    expect((await get('/api/v1/search/suggest?q=news&limit=11')).status).toBe(400);
    expect((await get('/api/v1/search/suggest')).status).toBe(400);
  });
});
