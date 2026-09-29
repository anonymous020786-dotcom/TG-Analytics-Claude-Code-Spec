import { describe, expect, it } from 'vitest';
import { assessChannelQuality, checkPlausibility, detectAnomalies, freshnessOf, MAX_PLAUSIBLE_COUNT } from './quality';

const H = 3_600_000;
const now = new Date('2026-09-28T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('freshnessOf', () => {
  it('is "never" without an observation (unavailable stays unavailable)', () => {
    expect(freshnessOf(null, 6 * H, now)).toEqual({ state: 'never', ageMs: null, observedAt: null });
  });

  it('is fresh within 2x the refresh interval and stale beyond it', () => {
    expect(freshnessOf(ago(6 * H), 6 * H, now).state).toBe('fresh');
    expect(freshnessOf(ago(12 * H), 6 * H, now).state).toBe('fresh');
    expect(freshnessOf(ago(12 * H + 1), 6 * H, now)).toMatchObject({ state: 'stale', ageMs: 12 * H + 1 });
  });

  it('treats slightly-future observations (clock skew) as age 0', () => {
    expect(freshnessOf(new Date(now.getTime() + 1_000), H, now)).toMatchObject({ state: 'fresh', ageMs: 0 });
  });
});

describe('checkPlausibility', () => {
  it('accepts real values including an observed zero', () => {
    expect(checkPlausibility(0n, now, now)).toEqual({ ok: true });
    expect(checkPlausibility(9_443_469n, now, now)).toEqual({ ok: true });
  });

  it.each([
    [-1n, now, 'negative'],
    [MAX_PLAUSIBLE_COUNT + 1n, now, 'implausibly_large'],
    [10n, new Date(now.getTime() + 10 * 60_000), 'future_observation'],
  ] as const)('rejects %s', (value, at, reason) => {
    expect(checkPlausibility(value, at, now)).toEqual({ ok: false, reason });
  });
});

describe('detectAnomalies', () => {
  const prev = (value: bigint, age = H) => ({ value, observedAt: ago(age) });
  const cur = (value: bigint) => ({ value, observedAt: now });

  it('flags a drop to zero', () => {
    expect(detectAnomalies(prev(50_000n), cur(0n))).toEqual([{ rule: 'drop_to_zero', previousValue: 50_000n, value: 0n, relativeChange: -1 }]);
  });

  it('flags large increases and decreases at the threshold', () => {
    expect(detectAnomalies(prev(10_000n), cur(15_000n))[0]?.rule).toBe('large_increase');
    expect(detectAnomalies(prev(10_000n), cur(5_000n))[0]?.rule).toBe('large_decrease');
  });

  it('ignores normal changes, small bases, stale baselines and out-of-order data', () => {
    expect(detectAnomalies(prev(10_000n), cur(12_000n))).toEqual([]);
    expect(detectAnomalies(prev(500n), cur(0n))).toEqual([]);
    expect(detectAnomalies(prev(10_000n, 8 * 24 * H), cur(1n))).toEqual([]);
    expect(detectAnomalies({ value: 10_000n, observedAt: new Date(now.getTime() + H) }, cur(1n))).toEqual([]);
    expect(detectAnomalies(null, cur(0n))).toEqual([]);
  });

  it('respects custom thresholds', () => {
    expect(detectAnomalies(prev(100n), cur(130n), { relativeChange: 0.25, minBase: 50n, maxGapMs: 2 * H })[0]?.rule).toBe('large_increase');
  });
});

describe('assessChannelQuality', () => {
  const intervals = { metricsMs: 6 * H, metadataMs: 24 * H };
  const base = { status: 'active', collectionStatus: 'ok', lastCollectionErrorClass: null, memberCountObservedAt: ago(H), metadataObservedAt: ago(H) };

  it.each([
    ['ok', {}],
    ['stale', { memberCountObservedAt: ago(13 * H) }],
    ['stale', { metadataObservedAt: ago(49 * H) }],
    ['never_collected', { memberCountObservedAt: null, collectionStatus: 'pending' }],
    ['failing', { collectionStatus: 'failed', lastCollectionErrorClass: 'transient' }],
    ['unavailable', { status: 'inaccessible', collectionStatus: 'failed' }],
  ] as const)('verdict %s', (verdict, overrides) => {
    expect(assessChannelQuality({ ...base, ...overrides }, intervals, now).verdict).toBe(verdict);
  });

  it('exposes per-metric freshness and the failure cause', () => {
    const q = assessChannelQuality({ ...base, collectionStatus: 'failed', lastCollectionErrorClass: 'rate_limited' }, intervals, now);
    expect(q).toMatchObject({ members: { state: 'fresh', ageMs: H }, lastCollectionErrorClass: 'rate_limited' });
  });
});
