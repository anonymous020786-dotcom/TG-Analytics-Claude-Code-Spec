import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AnomalyRepository, ChannelRepository, InvalidCursorError, PostgresAnalyticsStore, RankingRepository } from '../src';
import { makeChannel, resetTables, testDb } from './helpers';

const db = testDb();
const rankings = new RankingRepository(db);
const store = new PostgresAnalyticsStore(db);
const anomalies = new AnomalyRepository(db);
const channels = new ChannelRepository(db);
const t = (h: number) => new Date(Date.UTC(2026, 8, 20, h));

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE ranking_snapshots, ranking_runs, metric_anomalies RESTART IDENTITY CASCADE');
  await db.$executeRawUnsafe('DELETE FROM channel_metric_snapshots');
  await resetTables(db);
});
afterAll(() => db.$disconnect());

describe('RankingRepository', () => {
  it('saves an immutable run idempotently per (ranking, version, asOf) and pages entries', async () => {
    const [a, b, c] = [await makeChannel(db), await makeChannel(db), await makeChannel(db)];
    const input = {
      rankingKey: 'top-subscribers',
      methodologyVersion: 'rank-members-v1',
      asOf: t(12),
      eligibleCount: 3,
      entries: [
        { position: 1, channelId: a.id, score: 300 },
        { position: 2, channelId: b.id, score: 200 },
        { position: 3, channelId: c.id, score: 100 },
      ],
    };
    const first = await rankings.saveRun(input);
    const second = await rankings.saveRun(input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ runId: first.runId, created: false });
    expect(await db.rankingSnapshot.count()).toBe(3);

    const page1 = await rankings.entries(first.runId, { limit: 2 });
    expect(page1.items.map((e) => e.position)).toEqual([1, 2]);
    const page2 = await rankings.entries(first.runId, { limit: 2, cursor: page1.nextCursor! });
    expect(page2).toMatchObject({ items: [{ position: 3, channelId: c.id }], nextCursor: null });
    await expect(rankings.entries(first.runId, { cursor: 'bogus!' })).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('returns the latest run and blocks updates', async () => {
    const a = await makeChannel(db);
    await rankings.saveRun({ rankingKey: 'trending', methodologyVersion: 'trending-v1', asOf: t(10), eligibleCount: 1, entries: [{ position: 1, channelId: a.id, score: 1 }] });
    const { runId } = await rankings.saveRun({ rankingKey: 'trending', methodologyVersion: 'trending-v1', asOf: t(11), eligibleCount: 0, entries: [] });
    expect((await rankings.latestRun('trending'))?.id).toBe(runId);
    await expect(db.rankingSnapshot.updateMany({ data: { score: 999 } })).rejects.toThrow(/immutable/);
    await expect(db.rankingRun.updateMany({ data: { eligibleCount: 5 } })).rejects.toThrow(/immutable/);
  });

  it('rejects invalid positions, counts and non-finite scores', async () => {
    const a = await makeChannel(db);
    const base = { rankingKey: 'top-subscribers', methodologyVersion: 'v', eligibleCount: 1 };
    await expect(rankings.saveRun({ ...base, asOf: t(1), entries: [{ position: 0, channelId: a.id, score: 1 }] })).rejects.toThrow();
    await expect(rankings.saveRun({ ...base, asOf: t(2), eligibleCount: 0, entries: [{ position: 1, channelId: a.id, score: 1 }] })).rejects.toThrow();
    await expect(rankings.saveRun({ ...base, asOf: t(3), entries: [{ position: 1, channelId: a.id, score: Number.NaN }] })).rejects.toThrow();
    expect(await db.rankingRun.count()).toBe(0);
    // Database-level guard too (PostgreSQL treats NaN = NaN as true, so the CHECK lists NaN explicitly).
    const run = await db.rankingRun.create({ data: { rankingKey: "top-subscribers", methodologyVersion: "v", asOf: t(4), eligibleCount: 1, entryCount: 1 } });
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      await expect(db.rankingSnapshot.create({ data: { runId: run.id, position: 1, channelId: a.id, score } })).rejects.toThrow();
    }
  });
});

describe('PostgresAnalyticsStore.latestChannelValues (batch)', () => {
  it('returns the latest non-anomalous value per channel within the window in one call', async () => {
    const [a, b, c] = [await makeChannel(db), await makeChannel(db), await makeChannel(db)];
    const snap = (entityId: string, h: number, value: bigint) => ({ entityId, metric: 'members', value, observedAt: t(h), source: 'bot_api' as const });
    await store.appendChannelSnapshots([snap(a.id, 1, 100n), snap(a.id, 5, 150n), snap(a.id, 9, 999n), snap(b.id, 2, 70n), snap(b.id, 6, 0n), snap(c.id, 0, 5n)]);
    await anomalies.record(b.id, 'members', t(6), [{ rule: 'drop_to_zero', previousValue: 70n, value: 0n, relativeChange: -1 }]);

    const map = await store.latestChannelValues('members', [a.id, b.id, c.id], t(8), t(1));
    expect(map.get(a.id)?.value).toBe(150n); // t(9) is after `at`
    expect(map.get(b.id)?.value).toBe(70n); // anomalous t(6) excluded
    expect(map.has(c.id)).toBe(false); // outside window: unavailable, not 0
  });

  it('is empty for no ids and bounded for huge batches', async () => {
    expect((await store.latestChannelValues('members', [], t(1), t(0))).size).toBe(0);
    const ids = Array.from({ length: 1_001 }, () => '01920000-0000-7000-8000-000000000001');
    await expect(store.latestChannelValues('members', ids, t(1), t(0))).rejects.toThrow(/MAX_BATCH_ENTITIES/);
  });
});

describe('ChannelRepository.rankable', () => {
  it('pages active, visible channels only', async () => {
    const a = await makeChannel(db);
    await makeChannel(db, { hiddenAt: new Date() });
    const b = await makeChannel(db);
    await db.channel.update({ where: { id: b.id }, data: { status: 'inaccessible' } });
    const c = await makeChannel(db);
    expect((await channels.rankable(undefined, 10)).map((x) => x.id)).toEqual([a.id, c.id]);
    expect((await channels.rankable(a.id, 10)).map((x) => x.id)).toEqual([c.id]);
  });
});
