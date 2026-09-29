/**
 * Growth calculators (METRICS.md). Pure; callers pass the series and `asOf`.
 *
 *   absolute_growth   = current - previous_valid
 *   percentage_growth = (current - previous_valid) / previous_valid * 100   when previous_valid != 0
 *
 * Unavailable metrics remain unavailable: a missing input yields `{ available: false, reason }`,
 * never 0. Methodology versions are part of every result so displays and rankings can say
 * which rules produced a number.
 */

export const GROWTH_METHODOLOGY_VERSION = 'growth-v1';

export interface Point {
  value: bigint;
  observedAt: Date;
  /** Flagged by PHASE-10 anomaly detection; excluded as a baseline in growth-v1. */
  anomalous?: boolean;
}

export type Unavailable = { available: false; reason: 'no_current' | 'no_baseline' | 'zero_baseline' | 'current_too_old' };

export type Growth =
  | {
      available: true;
      current: bigint;
      previous: bigint;
      absolute: bigint;
      /** Null when previous is 0 (percentage undefined), never a fabricated value. */
      percentage: number | null;
      currentAt: Date;
      previousAt: Date;
      methodologyVersion: string;
    }
  | (Unavailable & { methodologyVersion: string });

export interface GrowthOptions {
  /** Growth window, e.g. 7 days. */
  windowMs: number;
  /** The current value must be at most this old relative to `asOf`. */
  maxCurrentAgeMs: number;
  /**
   * The baseline is the latest valid point at or before `asOf - windowMs`, and must not be
   * older than `asOf - windowMs - baselineToleranceMs` (otherwise the window is not covered).
   */
  baselineToleranceMs: number;
}

function latestAtOrBefore(points: readonly Point[], at: number, notBefore: number): Point | undefined {
  let best: Point | undefined;
  for (const p of points) {
    const t = p.observedAt.getTime();
    if (p.anomalous || t > at || t < notBefore) continue;
    if (!best || t > best.observedAt.getTime()) best = p;
  }
  return best;
}

export function growth(points: readonly Point[], asOf: Date, options: GrowthOptions): Growth {
  const methodologyVersion = GROWTH_METHODOLOGY_VERSION;
  const now = asOf.getTime();
  const current = latestAtOrBefore(points, now, now - options.maxCurrentAgeMs);
  if (!current) {
    const anyCurrent = latestAtOrBefore(points, now, Number.NEGATIVE_INFINITY);
    return { available: false, reason: anyCurrent ? 'current_too_old' : 'no_current', methodologyVersion };
  }
  const windowStart = now - options.windowMs;
  const previous = latestAtOrBefore(points, windowStart, windowStart - options.baselineToleranceMs);
  if (!previous) return { available: false, reason: 'no_baseline', methodologyVersion };
  const absolute = current.value - previous.value;
  const percentage = previous.value === 0n ? null : (Number(absolute) / Number(previous.value)) * 100;
  return {
    available: true,
    current: current.value,
    previous: previous.value,
    absolute,
    percentage,
    currentAt: current.observedAt,
    previousAt: previous.observedAt,
    methodologyVersion,
  };
}

const DAY = 86_400_000;

/** Standard windows (provisional tolerances until OD-005). */
export const GROWTH_WINDOWS = {
  '1d': { windowMs: DAY, maxCurrentAgeMs: DAY, baselineToleranceMs: DAY / 2 },
  '7d': { windowMs: 7 * DAY, maxCurrentAgeMs: DAY, baselineToleranceMs: DAY },
  '30d': { windowMs: 30 * DAY, maxCurrentAgeMs: DAY, baselineToleranceMs: 3 * DAY },
} as const satisfies Record<string, GrowthOptions>;

export type GrowthWindow = keyof typeof GROWTH_WINDOWS;
