import { AnomalyRepository, ChannelRepository, createDatabase, PostgresAnalyticsStore, RankingRepository } from '@tga/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { computeRanking } from './compute-ranking';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const deps = { channels: new ChannelRepository(db), store: new PostgresAnalyticsStore(db), rankings: new RankingRepository(db) };
const anomalies = new AnomalyRepository(db);

const DAY = 86_400_000;
const asOf = new Date('2026-09-20T12:00:00Z');
const ago = (days: number) => new Date(asOf.getTime() - days * DAY);

let tid = 0n;
async function channel(history: [daysAgo: number, value: bigint][], opts: { hidden?: boolean } = {}) {
  tid += 1n;
  const c = await db.channel.create({ data: { telegramId: -1000000000000n - tid, type: 'channel', username: `ch_${tid}`, title: `C${tid}`, hiddenAt: opts.hidden ? asOf : null } });
  await deps.store.appendChannelSnapshots(history.map(([d, v]) => ({ entityId: c.id, metric: 'members', value: v, observedAt: ago(d), source: 'bot_api' as const })));
  return c;
}

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE ranking_snapshots, ranking_runs, metric_anomalies RESTART IDENTITY CASCADE');
  await db.$executeRawUnsafe('DELETE FROM channel_metric_snapshots');
  await db.$executeRawUnsafe('TRUNCATE channel_aliases, channels RESTART IDENTITY CASCADE');
});
afterAll(() => db.$disconnect());

const entriesOf = async (runId: string) => (await deps.rankings.entries(runId, { limit: 100 })).items;

describe('computeRanking', () => {
  it('top-subscribers: ranks fresh, visible channels by current members', async () => {
    const big = await channel([[0.1, 9_000n]]);
    const small = await channel([[0.1, 5n]]);
    await channel([[3, 50_000n]]); // stale: no value within 1 day
    await channel([[0.1, 99_999n]], { hidden: true });

    const r = await computeRanking(deps, 'top-subscribers', asOf);
    expect(r).toMatchObject({ created: true, entries: 2, eligible: 2 });
    expect((await entriesOf(r.runId)).map((e) => [e.position, e.channelId, e.score])).toEqual([
      [1, big.id, 9_000],
      [2, small.id, 5],
    ]);
    expect((await deps.rankings.latestRun('top-subscribers'))?.methodologyVersion).toBe('rank-members-v1');
  });

  it('fastest-growing-7d: absolute growth over 7 days, min base 1,000, unavailable channels excluded', async () => {
    const fast = await channel([[7, 10_000n], [0.1, 13_000n]]);
    const slow = await channel([[7, 10_000n], [0.1, 10_500n]]);
    await channel([[0.1, 20_000n]]); // no baseline → unavailable
    await channel([[7, 10n], [0.1, 900n]]); // below min base

    const r = await computeRanking(deps, 'fastest-growing-7d', asOf);
    expect((await entriesOf(r.runId)).map((e) => [e.channelId, e.score])).toEqual([
      [fast.id, 3_000],
      [slow.id, 500],
    ]);
  });

  it('ignores anomalous observations (methodology v1) instead of rewarding a glitch', async () => {
    const glitch = await channel([[7, 10_000n], [0.2, 10_100n], [0.1, 90_000n]]);
    await anomalies.record(glitch.id, 'members', ago(0.1), [{ rule: 'large_increase', previousValue: 10_100n, value: 90_000n, relativeChange: 7.9 }]);
    const r = await computeRanking(deps, 'fastest-growing-7d', asOf);
    expect((await entriesOf(r.runId))[0]).toMatchObject({ channelId: glitch.id, score: 100 });
  });

  it('trending: needs both 1d and 7d growth', async () => {
    const hot = await channel([[7, 10_000n], [1, 10_000n], [0.1, 12_000n]]);
    await channel([[7, 10_000n], [0.1, 12_000n]]); // no 1d baseline → unavailable
    const r = await computeRanking(deps, 'trending', asOf);
    const entries = await entriesOf(r.runId);
    expect(entries.map((e) => e.channelId)).toEqual([hot.id]);
    expect(entries[0]?.score).toBeCloseTo(0.7 * 20 + 0.3 * 20);
  });

  it('is idempotent per window and deterministic on ties', async () => {
    const a = await channel([[0.1, 500n]]);
    const b = await channel([[0.1, 500n]]);
    const first = await computeRanking(deps, 'top-subscribers', asOf);
    const again = await computeRanking(deps, 'top-subscribers', asOf);
    expect(again).toMatchObject({ runId: first.runId, created: false });
    // Tie-break: channel id (UUID v7) ascending, i.e. earliest discovered first.
    expect((await entriesOf(first.runId)).map((e) => e.channelId)).toEqual([a.id, b.id].sort());
  });

  it('rejects unknown rankings as invalid_input', async () => {
    await expect(computeRanking(deps, 'made-up', asOf)).rejects.toMatchObject({ failureClass: 'invalid_input', code: 'unknown_ranking' });
  });
});
