import { GROWTH_METHODOLOGY_VERSION, GROWTH_WINDOWS, type GrowthWindow } from './growth';

/**
 * Metric registry (FR-ANL-01, METRICS.md "Metric Contract"). Every metric shown anywhere must
 * have an entry; tests fail if a field is missing. Only metrics backed by verified data sources
 * are listed (CAPABILITY-MATRIX): post views/engagement arrive once MTProto is verified (OD-003).
 */
export interface MetricDefinition {
  key: string;
  label: string;
  kind: 'raw' | 'calculated';
  /** Where the input comes from. */
  source: string;
  /** Which timestamp the value refers to. */
  observationTime: string;
  calculation: string;
  window: string | null;
  missingData: string;
  freshness: string;
  unit: 'count' | 'percent';
  methodologyVersion: string;
}

const growthEntries = (Object.keys(GROWTH_WINDOWS) as GrowthWindow[]).flatMap((w): MetricDefinition[] => [
  {
    key: `members_growth_${w}`,
    label: `Subscriber growth (${w})`,
    kind: 'calculated',
    source: 'members snapshots',
    observationTime: 'observed_at of the current snapshot',
    calculation: `current - previous_valid, previous_valid = latest non-anomalous snapshot at or before (asOf - ${w})`,
    window: w,
    missingData: 'unavailable when no current snapshot within 1 day or no baseline within tolerance; never 0',
    freshness: 'inherits members freshness',
    unit: 'count',
    methodologyVersion: GROWTH_METHODOLOGY_VERSION,
  },
  {
    key: `members_growth_pct_${w}`,
    label: `Subscriber growth % (${w})`,
    kind: 'calculated',
    source: 'members snapshots',
    observationTime: 'observed_at of the current snapshot',
    calculation: `(current - previous_valid) / previous_valid * 100 when previous_valid != 0`,
    window: w,
    missingData: 'unavailable as for growth; null (not 0) when previous_valid = 0',
    freshness: 'inherits members freshness',
    unit: 'percent',
    methodologyVersion: GROWTH_METHODOLOGY_VERSION,
  },
]);

export const METRIC_REGISTRY: readonly MetricDefinition[] = [
  {
    key: 'members',
    label: 'Subscribers',
    kind: 'raw',
    source: 'Telegram Bot API getChatMemberCount (CAPABILITY-MATRIX)',
    observationTime: 'time the count was fetched (observed_at)',
    calculation: 'as reported by Telegram; implausible values rejected (PHASE-10)',
    window: null,
    missingData: 'unavailable when never observed; never 0',
    freshness: 'stale after 2x METRICS_REFRESH_MINUTES',
    unit: 'count',
    methodologyVersion: 'raw',
  },
  ...growthEntries,
];

export function metricDefinition(key: string): MetricDefinition | undefined {
  return METRIC_REGISTRY.find((m) => m.key === key);
}
