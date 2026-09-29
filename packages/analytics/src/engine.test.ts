import { describe, expect, it } from 'vitest';
import { GROWTH_METHODOLOGY_VERSION, GROWTH_WINDOWS, growth, type Point } from './growth';
import { rank, RANKINGS, type RankingCandidate, trendingScoreV1 } from './ranking';
import { METRIC_REGISTRY, metricDefinition } from './registry';

const DAY = 86_400_000;
const asOf = new Date('2026-09-28T12:00:00Z');
const at = (daysAgo: number) => new Date(asOf.getTime() - daysAgo * DAY);
const p = (daysAgo: number, value: bigint, anomalous = false): Point => ({ value, observedAt: at(daysAgo), anomalous });

describe('growth (growth-v1)', () => {
  const w7 = GROWTH_WINDOWS['7d'];

  it('computes absolute and percentage growth against the previous valid baseline', () => {
    const g = growth([p(8, 900n), p(7, 1_000n), p(3, 1_100n), p(0.1, 1_200n)], asOf, w7);
    expect(g).toMatchObject({ available: true, current: 1_200n, previous: 1_000n, absolute: 200n, percentage: 20, methodologyVersion: GROWTH_METHODOLOGY_VERSION });
  });

  it('is unavailable (never 0) without a current value, a baseline, or a fresh current value', () => {
    expect(growth([], asOf, w7)).toMatchObject({ available: false, reason: 'no_current' });
    expect(growth([p(0.1, 5n)], asOf, w7)).toMatchObject({ available: false, reason: 'no_baseline' });
    expect(growth([p(10, 5n), p(3, 7n)], asOf, w7)).toMatchObject({ available: false, reason: 'current_too_old' });
    expect(growth([p(20, 5n), p(0.1, 7n)], asOf, w7)).toMatchObject({ available: false, reason: 'no_baseline' });
  });

  it('returns a null percentage when the baseline is zero', () => {
    expect(growth([p(7, 0n), p(0.1, 50n)], asOf, w7)).toMatchObject({ available: true, absolute: 50n, percentage: null });
  });

  it('handles negative growth', () => {
    expect(growth([p(7, 1_000n), p(0.1, 750n)], asOf, w7)).toMatchObject({ absolute: -250n, percentage: -25 });
  });

  it('skips anomalous observations as baseline and current (methodology v1)', () => {
    const g = growth([p(7.5, 1_000n), p(7, 0n, true), p(0.2, 1_100n), p(0.1, 0n, true)], asOf, w7);
    expect(g).toMatchObject({ available: true, previous: 1_000n, current: 1_100n });
  });

  it('ignores observations after asOf (no look-ahead)', () => {
    expect(growth([p(7, 1_000n), p(0.1, 1_100n), p(-1, 9_999n)], asOf, w7)).toMatchObject({ current: 1_100n });
  });
});

describe('metric registry (FR-ANL-01)', () => {
  it('defines every contract field for every metric', () => {
    const fields = ['key', 'label', 'kind', 'source', 'observationTime', 'calculation', 'missingData', 'freshness', 'unit', 'methodologyVersion'] as const;
    for (const m of METRIC_REGISTRY) for (const f of fields) expect(String(m[f]).length, `${m.key}.${f}`).toBeGreaterThan(0);
    expect(new Set(METRIC_REGISTRY.map((m) => m.key)).size).toBe(METRIC_REGISTRY.length);
  });

  it('covers every metric that rankings reference, except composite scores documented in TRENDING.md', () => {
    for (const r of RANKINGS) if (r.metric !== 'trending_score') expect(metricDefinition(r.metric), r.key).toBeDefined();
  });
});

describe('rank (RANKINGS.md)', () => {
  const def = RANKINGS.find((r) => r.key === 'fastest-growing-7d')!;
  const c = (id: string, score: number | null, base: bigint | null = 5_000n, fresh = true): RankingCandidate => ({ entityId: id, tieBreakKey: id, score, base, fresh });

  it('orders by score, breaks ties deterministically and numbers positions', () => {
    const r = rank(def, [c('b', 10), c('a', 10), c('c', 50)]);
    expect(r.entries).toEqual([
      { position: 1, entityId: 'c', score: 50 },
      { position: 2, entityId: 'a', score: 10 },
      { position: 3, entityId: 'b', score: 10 },
    ]);
    expect(r.methodologyVersion).toBe('rank-growth7d-v1');
  });

  it('excludes unavailable, stale and below-base candidates', () => {
    const r = rank(def, [c('ok', 1), c('none', null), c('stale', 99, 5_000n, false), c('small', 99, 10n), c('nobase', 99, null), c('nan', Number.NaN)]);
    expect(r.entries.map((e) => e.entityId)).toEqual(['ok']);
    expect(r.eligibleCount).toBe(1);
  });

  it('is bounded by the definition limit and identical for identical input', () => {
    const many = Array.from({ length: 1_500 }, (_, i) => c(`e${String(i).padStart(4, '0')}`, i % 7));
    const r1 = rank(def, many);
    expect(r1.entries).toHaveLength(def.limit);
    expect(rank(def, [...many].reverse())).toEqual(r1);
  });

  it('declares every RANKINGS.md field and a disclaimer', () => {
    for (const r of RANKINGS) {
      expect(r).toMatchObject({ tieBreak: 'score_desc_then_key_asc' });
      expect(r.methodologyVersion.length).toBeGreaterThan(0);
      expect(r.disclaimer).toMatch(/not an official Telegram ranking/);
    }
  });
});

describe('trendingScoreV1', () => {
  it('weights 1d and 7d growth and stays unavailable without either input', () => {
    expect(trendingScoreV1(10, 20)).toBeCloseTo(13);
    expect(trendingScoreV1(null, 20)).toBeNull();
    expect(trendingScoreV1(10, null)).toBeNull();
  });
});
