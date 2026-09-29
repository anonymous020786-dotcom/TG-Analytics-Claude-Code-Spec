/**
 * Data-quality calculations (PHASE-10, METRICS.md). Pure functions: no I/O, no clocks
 * (callers pass `now`). Thresholds are provisional until OD-005 and are parameters, not
 * hidden constants.
 */

export type FreshnessState = 'fresh' | 'stale' | 'never';

export interface Freshness {
  state: FreshnessState;
  /** Age of the last observation in ms; null when never observed. */
  ageMs: number | null;
  observedAt: Date | null;
}

/** An observation is stale once it is older than `staleAfterFactor` × the expected refresh interval. */
export const DEFAULT_STALE_AFTER_FACTOR = 2;

export function freshnessOf(observedAt: Date | null, expectedIntervalMs: number, now: Date, staleAfterFactor = DEFAULT_STALE_AFTER_FACTOR): Freshness {
  if (!observedAt) return { state: 'never', ageMs: null, observedAt: null };
  const ageMs = Math.max(0, now.getTime() - observedAt.getTime());
  return { state: ageMs > expectedIntervalMs * staleAfterFactor ? 'stale' : 'fresh', ageMs, observedAt };
}

/**
 * Raw-value plausibility (validation before storage). Impossible values are rejected;
 * surprising-but-possible values are kept and flagged by `detectAnomalies` instead.
 */
export const MAX_PLAUSIBLE_COUNT = 10_000_000_000n;

export type PlausibilityResult = { ok: true } | { ok: false; reason: 'negative' | 'implausibly_large' | 'future_observation' };

export function checkPlausibility(value: bigint, observedAt: Date, now: Date, maxClockSkewMs = 5 * 60_000): PlausibilityResult {
  if (value < 0n) return { ok: false, reason: 'negative' };
  if (value > MAX_PLAUSIBLE_COUNT) return { ok: false, reason: 'implausibly_large' };
  if (observedAt.getTime() > now.getTime() + maxClockSkewMs) return { ok: false, reason: 'future_observation' };
  return { ok: true };
}

export type AnomalyRule = 'drop_to_zero' | 'large_increase' | 'large_decrease';

export interface Anomaly {
  rule: AnomalyRule;
  previousValue: bigint;
  value: bigint;
  /** Relative change vs the previous valid observation (e.g. -0.75 = -75%). */
  relativeChange: number;
}

export interface AnomalyThresholds {
  /** Relative change that counts as anomalous (0.5 = ±50%). */
  relativeChange: number;
  /** Ignore small bases where large relative swings are normal. */
  minBase: bigint;
  /** Only compare against observations at most this old. */
  maxGapMs: number;
}

/** Provisional (OD-005): ±50% on bases ≥ 1,000 within 7 days. */
export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = { relativeChange: 0.5, minBase: 1_000n, maxGapMs: 7 * 24 * 3_600_000 };

/**
 * Compares a new observation with the previous valid one. Never alters or drops values —
 * it only reports what looks suspicious so analytics can annotate or exclude it (PHASE-11).
 */
export function detectAnomalies(
  previous: { value: bigint; observedAt: Date } | null,
  current: { value: bigint; observedAt: Date },
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): Anomaly[] {
  if (!previous || previous.value < thresholds.minBase) return [];
  const gap = current.observedAt.getTime() - previous.observedAt.getTime();
  if (gap <= 0 || gap > thresholds.maxGapMs) return [];
  const relativeChange = Number(current.value - previous.value) / Number(previous.value);
  const base = { previousValue: previous.value, value: current.value, relativeChange };
  if (current.value === 0n) return [{ rule: 'drop_to_zero', ...base }];
  if (relativeChange >= thresholds.relativeChange) return [{ rule: 'large_increase', ...base }];
  if (relativeChange <= -thresholds.relativeChange) return [{ rule: 'large_decrease', ...base }];
  return [];
}

export type QualityVerdict = 'ok' | 'stale' | 'failing' | 'never_collected' | 'unavailable';

export interface ChannelQualityInput {
  /** Telegram-side availability: active | not_public | deleted | inaccessible. */
  status: string;
  /** pending | ok | failed */
  collectionStatus: string;
  lastCollectionErrorClass: string | null;
  memberCountObservedAt: Date | null;
  metadataObservedAt: Date | null;
}

export interface ChannelQuality {
  verdict: QualityVerdict;
  members: Freshness;
  metadata: Freshness;
  lastCollectionErrorClass: string | null;
}

/**
 * Combined data-quality view for display (FR-DQ-01: every metric shows freshness and
 * collection status). Precedence: unavailable > failing > never_collected > stale > ok.
 */
export function assessChannelQuality(
  input: ChannelQualityInput,
  intervals: { metricsMs: number; metadataMs: number },
  now: Date,
  staleAfterFactor = DEFAULT_STALE_AFTER_FACTOR,
): ChannelQuality {
  const members = freshnessOf(input.memberCountObservedAt, intervals.metricsMs, now, staleAfterFactor);
  const metadata = freshnessOf(input.metadataObservedAt, intervals.metadataMs, now, staleAfterFactor);
  let verdict: QualityVerdict;
  if (input.status !== 'active') verdict = 'unavailable';
  else if (input.collectionStatus === 'failed') verdict = 'failing';
  else if (members.state === 'never') verdict = 'never_collected';
  else if (members.state === 'stale' || metadata.state === 'stale') verdict = 'stale';
  else verdict = 'ok';
  return { verdict, members, metadata, lastCollectionErrorClass: input.lastCollectionErrorClass };
}
