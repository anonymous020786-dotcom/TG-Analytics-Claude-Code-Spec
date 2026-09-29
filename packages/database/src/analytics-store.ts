import {
  type AnalyticsStore,
  type AppendResult,
  MAX_SERIES_POINTS,
  type MetricSnapshot,
  type SeriesPoint,
  type SeriesQuery,
  type SnapshotSource,
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

  async latestChannelValue(channelId: string, metric: string): Promise<SeriesPoint | null> {
    const row = await this.db.channelMetricSnapshot.findFirst({
      where: { channelId, metric },
      orderBy: { observedAt: 'desc' },
      select: { value: true, observedAt: true, source: true },
    });
    return row ? toPoint(row) : null;
  }
}
