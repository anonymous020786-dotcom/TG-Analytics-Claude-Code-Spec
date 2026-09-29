import { MAX_SERIES_POINTS, type MetricSnapshot, SnapshotValidationError } from '@tga/types';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresAnalyticsStore } from '../src';
import { makeChannel, resetTables, testDb } from './helpers';

const db = testDb();
const store = new PostgresAnalyticsStore(db);

beforeEach(async () => {
  await db.$executeRawUnsafe('DELETE FROM channel_metric_snapshots');
  await db.$executeRawUnsafe('DELETE FROM post_metric_snapshots');
  await resetTables(db);
});
afterAll(() => db.$disconnect());

const day = (d: number) => new Date(Date.UTC(2026, 0, d));
const snap = (entityId: string, d: number, value: bigint, metric = 'members'): MetricSnapshot => ({
  entityId,
  metric,
  value,
  observedAt: day(d),
  source: 'mtproto',
});

describe('PostgresAnalyticsStore — channels', () => {
  it('appends snapshots and reads an oldest-first series within [from, to)', async () => {
    const c = await makeChannel(db);
    const res = await store.appendChannelSnapshots([snap(c.id, 1, 100n), snap(c.id, 2, 110n), snap(c.id, 3, 125n)]);

    expect(res).toEqual({ inserted: 3, duplicates: 0 });
    const series = await store.channelSeries({ entityId: c.id, metric: 'members', from: day(1), to: day(3) });
    expect(series.map((p) => p.value)).toEqual([100n, 110n]);
    expect(series[0]?.source).toBe('mtproto');
  });

  it('is idempotent: re-appending the same observation never overwrites it', async () => {
    const c = await makeChannel(db);
    await store.appendChannelSnapshots([snap(c.id, 1, 100n)]);
    const res = await store.appendChannelSnapshots([snap(c.id, 1, 999n), snap(c.id, 2, 105n)]);

    expect(res).toEqual({ inserted: 1, duplicates: 1 });
    expect((await store.latestChannelValue(c.id, 'members'))?.value).toBe(105n);
    const first = await store.channelSeries({ entityId: c.id, metric: 'members', from: day(1), to: day(2) });
    expect(first.map((p) => p.value)).toEqual([100n]);
  });

  it('returns empty/null for never-observed metrics (never a fabricated 0)', async () => {
    const c = await makeChannel(db);
    expect(await store.latestChannelValue(c.id, 'members')).toBeNull();
    expect(await store.channelSeries({ entityId: c.id, metric: 'members', from: day(1), to: day(9) })).toEqual([]);
  });

  it('stores a genuinely observed zero', async () => {
    const c = await makeChannel(db);
    await store.appendChannelSnapshots([snap(c.id, 1, 0n)]);
    expect((await store.latestChannelValue(c.id, 'members'))?.value).toBe(0n);
  });

  it('keeps metrics separate and caps series length', async () => {
    const c = await makeChannel(db);
    await store.appendChannelSnapshots([snap(c.id, 1, 5n, 'views'), snap(c.id, 1, 7n)]);
    expect((await store.latestChannelValue(c.id, 'views'))?.value).toBe(5n);
    const capped = await store.channelSeries({ entityId: c.id, metric: 'members', from: day(1), to: day(2), limit: MAX_SERIES_POINTS * 10 });
    expect(capped.length).toBeLessThanOrEqual(MAX_SERIES_POINTS);
  });

  it('rejects invalid batches before writing anything', async () => {
    const c = await makeChannel(db);
    await expect(store.appendChannelSnapshots([snap(c.id, 1, 1n), { ...snap(c.id, 2, 1n), value: -1n }])).rejects.toBeInstanceOf(
      SnapshotValidationError,
    );
    expect(await db.channelMetricSnapshot.count()).toBe(0);
  });

  it('rejects snapshots for unknown channels (FK)', async () => {
    await expect(store.appendChannelSnapshots([snap('01920000-0000-7000-8000-00000000abcd', 1, 1n)])).rejects.toThrow();
  });

  it('is append-only in the database: UPDATE is blocked', async () => {
    const c = await makeChannel(db);
    await store.appendChannelSnapshots([snap(c.id, 1, 100n)]);
    await expect(db.channelMetricSnapshot.updateMany({ where: { channelId: c.id }, data: { value: 1n } })).rejects.toThrow(/append-only/);
  });

  it('enforces value, metric and source constraints in the database too', async () => {
    const c = await makeChannel(db);
    const base = { channelId: c.id, metric: 'members', value: 1n, observedAt: day(1), source: 'mtproto' };
    await expect(db.channelMetricSnapshot.create({ data: { ...base, value: -1n } })).rejects.toThrow();
    await expect(db.channelMetricSnapshot.create({ data: { ...base, metric: 'Bad Metric' } })).rejects.toThrow();
    await expect(db.channelMetricSnapshot.create({ data: { ...base, source: 'scraper' } })).rejects.toThrow();
  });

  it('keeps history: a channel with snapshots cannot be deleted', async () => {
    const c = await makeChannel(db);
    await store.appendChannelSnapshots([snap(c.id, 1, 100n)]);
    await expect(db.channel.delete({ where: { id: c.id } })).rejects.toThrow();
  });
});

describe('PostgresAnalyticsStore — posts', () => {
  it('appends and reads post snapshots idempotently', async () => {
    const c = await makeChannel(db);
    const p = await db.post.create({ data: { channelId: c.id, telegramMessageId: 1n, postedAt: day(1) } });

    expect(await store.appendPostSnapshots([snap(p.id, 1, 50n, 'views'), snap(p.id, 2, 80n, 'views')])).toEqual({ inserted: 2, duplicates: 0 });
    expect(await store.appendPostSnapshots([snap(p.id, 2, 80n, 'views')])).toEqual({ inserted: 0, duplicates: 1 });
    const series = await store.postSeries({ entityId: p.id, metric: 'views', from: day(1), to: day(9) });
    expect(series.map((x) => x.value)).toEqual([50n, 80n]);
  });
});
