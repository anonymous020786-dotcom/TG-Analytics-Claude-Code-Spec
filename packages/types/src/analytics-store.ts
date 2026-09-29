/**
 * Analytical storage contract (PHASE-05, ADR-002, ADR-011).
 *
 * Snapshots are raw, append-only observations: one row per (entity, metric, observedAt).
 * A metric that was not observed has no row — it is never stored as 0 (METRICS.md).
 * Calculated metrics (growth, engagement rates) are derived from snapshots in PHASE-11.
 */

/** Telegram interface that produced the observation (ADR-005). */
export const SNAPSHOT_SOURCES = ['bot_api', 'mtproto'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

/**
 * Metric key, e.g. "members" or "views". Lowercase, dot/underscore separated.
 * The metric registry with full definitions (FR-ANL-01) is added in PHASE-11.
 */
export const METRIC_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
export const METRIC_KEY_MAX_LENGTH = 64;

/** Maximum snapshots per append call (bounded payloads). */
export const MAX_SNAPSHOT_BATCH = 1_000;
/** Maximum points returned by one series query (provisional until OD-005). */
export const MAX_SERIES_POINTS = 5_000;

export interface MetricSnapshot {
  /** Channel id or post id (UUID), depending on the append method. */
  entityId: string;
  metric: string;
  /** Raw observed count; non-negative. */
  value: bigint;
  /** When Telegram reported the value (not when we stored it). */
  observedAt: Date;
  source: SnapshotSource;
  /** Collection job that produced it (provenance), when known. */
  jobId?: string;
}

export interface SeriesPoint {
  value: bigint;
  observedAt: Date;
  source: SnapshotSource;
}

export interface SeriesQuery {
  entityId: string;
  metric: string;
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  /** Capped at MAX_SERIES_POINTS. */
  limit?: number;
}

export interface AppendResult {
  inserted: number;
  /** Already-stored observations (same entity, metric and observedAt) that were skipped. */
  duplicates: number;
}

export interface AnalyticsStore {
  appendChannelSnapshots(snapshots: readonly MetricSnapshot[]): Promise<AppendResult>;
  appendPostSnapshots(snapshots: readonly MetricSnapshot[]): Promise<AppendResult>;
  /** Oldest-first points within [from, to). Empty when nothing was observed. */
  channelSeries(query: SeriesQuery): Promise<SeriesPoint[]>;
  postSeries(query: SeriesQuery): Promise<SeriesPoint[]>;
  /** Most recent observation, or null when the metric was never observed. */
  latestChannelValue(channelId: string, metric: string): Promise<SeriesPoint | null>;
  /**
   * Batch: for each channel, the latest non-anomalous observation with observedAt in
   * [notBefore, at]. Channels without one are absent from the map (unavailable, never 0).
   * One query for many channels (no N+1). Bounded by MAX_BATCH_ENTITIES.
   */
  latestChannelValues(metric: string, channelIds: readonly string[], at: Date, notBefore: Date): Promise<Map<string, SeriesPoint>>;
}

/** Upper bound of entities per batch read. */
export const MAX_BATCH_ENTITIES = 1_000;

export class SnapshotValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid snapshot batch:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'SnapshotValidationError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidMetricKey(metric: string): boolean {
  return metric.length <= METRIC_KEY_MAX_LENGTH && METRIC_KEY_PATTERN.test(metric);
}

/** Validates a batch before any write; throws SnapshotValidationError listing every problem. */
export function validateSnapshotBatch(snapshots: readonly MetricSnapshot[], now: Date = new Date()): void {
  const issues: string[] = [];
  if (snapshots.length > MAX_SNAPSHOT_BATCH) {
    issues.push(`batch of ${snapshots.length} exceeds MAX_SNAPSHOT_BATCH (${MAX_SNAPSHOT_BATCH})`);
  }
  snapshots.forEach((s, i) => {
    if (!UUID.test(s.entityId)) issues.push(`[${i}] entityId must be a UUID`);
    if (!isValidMetricKey(s.metric)) issues.push(`[${i}] invalid metric key "${s.metric.slice(0, 80)}"`);
    if (typeof s.value !== 'bigint' || s.value < 0n) issues.push(`[${i}] value must be a non-negative bigint`);
    if (!(s.observedAt instanceof Date) || Number.isNaN(s.observedAt.getTime())) {
      issues.push(`[${i}] observedAt must be a valid Date`);
    } else if (s.observedAt.getTime() > now.getTime() + 5 * 60_000) {
      issues.push(`[${i}] observedAt is in the future`);
    }
    if (!(SNAPSHOT_SOURCES as readonly string[]).includes(s.source)) issues.push(`[${i}] unknown source "${String(s.source)}"`);
    if (s.jobId !== undefined && !UUID.test(s.jobId)) issues.push(`[${i}] jobId must be a UUID`);
  });
  if (issues.length) throw new SnapshotValidationError(issues);
}

export function validateSeriesQuery(query: SeriesQuery): void {
  const issues: string[] = [];
  if (!UUID.test(query.entityId)) issues.push('entityId must be a UUID');
  if (!isValidMetricKey(query.metric)) issues.push('invalid metric key');
  if (Number.isNaN(query.from.getTime()) || Number.isNaN(query.to.getTime())) issues.push('from/to must be valid dates');
  else if (query.from >= query.to) issues.push('from must be earlier than to');
  if (issues.length) throw new SnapshotValidationError(issues);
}
