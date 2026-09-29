import {
  type AnalyticsStore,
  type AppendResult,
  MAX_BATCH_ENTITIES,
  MAX_SERIES_POINTS,
  type MetricSnapshot,
  type SeriesPoint,
  type SeriesQuery,
  type SnapshotSource,
  SnapshotValidationError,
  validateSeriesQuery,
  validateSnapshotBatch,
} from '@tga/types';
import type { Database } from './client';

function seriesLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return MAX_SERIES_POINTS;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SERIES_POINTS);
}

function toPoint(row: { value: bigint; observedAt: Date; source: string }): SeriesPoint {
  return { value: row.value, observedAt: row.observedAt, source: row.source as SnapshotSource };
}

/**
 * PostgreSQL-backed analytical store (ADR-011). Append-only: duplicate
 * (entity, metric, observedAt) rows are skipped, never overwritten.
 */
export class PostgresAnalyticsStore implements AnalyticsStore {
  constructor(private readonly db: Database) {}

  async appendChannelSnapshots(snapshots: readonly MetricSnapshot[]): Promise<AppendResult> {
    validateSnapshotBatch(snapshots);
    if (snapshots.length === 0) return { inserted: 0, duplicates: 0 };
    const { count } = await this.db.channelMetricSnapshot.createMany({
      data: snapshots.map((s) => ({
        channelId: s.entityId,
        metric: s.metric,
        value: s.value,
        observedAt: s.observedAt,
        source: s.source,
        jobId: s.jobId ?? null,
      })),
      skipDuplicates: true,
    });
    return { inserted: count, duplicates: snapshots.length - count };
  }

  async appendPostSnapshots(snapshots: readonly MetricSnapshot[]): Promise<AppendResult> {
    validateSnapshotBatch(snapshots);
    if (snapshots.length === 0) return { inserted: 0, duplicates: 0 };
    const { count } = await this.db.postMetricSnapshot.createMany({
      data: snapshots.map((s) => ({
        postId: s.entityId,
        metric: s.metric,
        value: s.value,
        observedAt: s.observedAt,
        source: s.source,
        jobId: s.jobId ?? null,
      })),
      skipDuplicates: true,
    });
    return { inserted: count, duplicates: snapshots.length - count };
  }

  async channelSeries(query: SeriesQuery): Promise<SeriesPoint[]> {
    validateSeriesQuery(query);
    const rows = await this.db.channelMetricSnapshot.findMany({
      where: { channelId: query.entityId, metric: query.metric, observedAt: { gte: query.from, lt: query.to } },
      orderBy: { observedAt: 'asc' },
      take: seriesLimit(query.limit),
      select: { value: true, observedAt: true, source: true },
    });
    return rows.map(toPoint);
  }

  async postSeries(query: SeriesQuery): Promise<SeriesPoint[]> {
    validateSeriesQuery(query);
    const rows = await this.db.postMetricSnapshot.findMany({
      where: { postId: query.entityId, metric: query.metric, observedAt: { gte: query.from, lt: query.to } },
      orderBy: { observedAt: 'asc' },
      take: seriesLimit(query.limit),
      select: { value: true, observedAt: true, source: true },
    });
    return rows.map(toPoint);
  }

  async latestChannelValues(metric: string, channelIds: readonly string[], at: Date, notBefore: Date): Promise<Map<string, SeriesPoint>> {
    if (channelIds.length === 0) return new Map();
    if (channelIds.length > MAX_BATCH_ENTITIES) throw new SnapshotValidationError([`batch of ${channelIds.length} exceeds MAX_BATCH_ENTITIES`]);
    // DISTINCT ON over the (channel_id, metric, observed_at) unique index; anomalous observations excluded.
    const rows = await this.db.$queryRaw<{ channel_id: string; value: bigint; observed_at: Date; source: string }[]>`
      SELECT DISTINCT ON (s.channel_id) s.channel_id, s.value, s.observed_at, s.source
      FROM channel_metric_snapshots s
      WHERE s.metric = ${metric}
        AND s.channel_id = ANY(${[...channelIds]}::uuid[])
        AND s.observed_at <= ${at}
        AND s.observed_at >= ${notBefore}
        AND NOT EXISTS (
          SELECT 1 FROM metric_anomalies a
          WHERE a.channel_id = s.channel_id AND a.metric = s.metric AND a.observed_at = s.observed_at
        )
      ORDER BY s.channel_id, s.observed_at DESC`;
    return new Map(rows.map((r) => [r.channel_id, toPoint({ value: r.value, observedAt: r.observed_at, source: r.source })]));
  }

  async latestChannelValue(channelId: string, metric: string): Promise<SeriesPoint | null> {
    const row = await this.db.channelMetricSnapshot.findFirst({
      where: { channelId, metric },
      orderBy: { observedAt: 'desc' },
      select: { value: true, observedAt: true, source: true },
    });
    return row ? toPoint(row) : null;
  }
}
