import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AnomalyRepository, ChannelRepository } from '../src';
import { makeChannel, resetTables, testDb } from './helpers';

const db = testDb();
const anomalies = new AnomalyRepository(db);
const channels = new ChannelRepository(db);
const t = (h: number) => new Date(Date.UTC(2026, 8, 28, h));

beforeEach(async () => {
  await db.$executeRawUnsafe('DELETE FROM metric_anomalies');
  await resetTables(db);
});
afterAll(() => db.$disconnect());

describe('AnomalyRepository', () => {
  const drop = { rule: 'drop_to_zero' as const, previousValue: 50_000n, value: 0n, relativeChange: -1 };

  it('records anomalies idempotently per (channel, metric, observedAt, rule)', async () => {
    const c = await makeChannel(db);
    expect(await anomalies.record(c.id, 'members', t(1), [drop])).toBe(1);
    expect(await anomalies.record(c.id, 'members', t(1), [drop])).toBe(0);
    expect(await anomalies.record(c.id, 'members', t(1), [])).toBe(0);
    expect(await db.metricAnomaly.count()).toBe(1);
  });

  it('returns anomalies for a window and pages recent ones', async () => {
    const c = await makeChannel(db);
    await anomalies.record(c.id, 'members', t(1), [drop]);
    await anomalies.record(c.id, 'members', t(5), [{ ...drop, rule: 'large_decrease', value: 10_000n, relativeChange: -0.8 }]);
    expect((await anomalies.forChannel(c.id, 'members', t(0), t(3))).map((a) => a.rule)).toEqual(['drop_to_zero']);
    const page = await anomalies.listRecent({ limit: 1 });
    expect(page.items).toHaveLength(1);
    expect((await anomalies.listRecent({ limit: 1, cursor: page.nextCursor! })).items).toHaveLength(1);
  });

  it('rejects unknown rules and negative values at the database', async () => {
    const c = await makeChannel(db);
    await expect(anomalies.record(c.id, 'members', t(1), [{ ...drop, rule: 'weird' as never }])).rejects.toThrow();
    await expect(anomalies.record(c.id, 'members', t(2), [{ ...drop, value: -1n }])).rejects.toThrow();
  });
});

describe('ChannelRepository.qualityView / failure class', () => {
  it('records the failure class and clears it on success', async () => {
    const c = await makeChannel(db);
    expect(await channels.qualityView(c.id)).toMatchObject({ collectionStatus: 'pending', lastCollectionErrorClass: null, memberCountObservedAt: null });
    await channels.recordCollectionFailure(c.id, 'dependency_down');
    expect(await channels.qualityView(c.id)).toMatchObject({ collectionStatus: 'failed', lastCollectionErrorClass: 'dependency_down' });
    await channels.recordMemberCount(c.id, 10n, t(3));
    expect(await channels.qualityView(c.id)).toMatchObject({ collectionStatus: 'ok', lastCollectionErrorClass: null, memberCountObservedAt: t(3) });
  });

  it('rejects unknown failure classes at the database', async () => {
    const c = await makeChannel(db);
    await expect(channels.recordCollectionFailure(c.id, 'oops' as never)).rejects.toThrow();
  });
});
