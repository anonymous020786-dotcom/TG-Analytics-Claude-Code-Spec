import type { Database } from '../client';
import type { MetricAnomaly } from '../generated/prisma/client';
import { clampLimit, decodeCursor, toPage, type Page } from '../pagination';

export interface AnomalyInput {
  rule: 'drop_to_zero' | 'large_increase' | 'large_decrease';
  previousValue: bigint;
  value: bigint;
  relativeChange: number;
}

/** Flags suspicious observations (PHASE-10). Idempotent per (channel, metric, observedAt, rule). */
export class AnomalyRepository {
  constructor(private readonly db: Database) {}

  async record(channelId: string, metric: string, observedAt: Date, anomalies: readonly AnomalyInput[]): Promise<number> {
    if (anomalies.length === 0) return 0;
    const { count } = await this.db.metricAnomaly.createMany({
      data: anomalies.map((a) => ({
        channelId,
        metric,
        observedAt,
        rule: a.rule,
        previousValue: a.previousValue,
        value: a.value,
        relativeChange: Number.isFinite(a.relativeChange) ? a.relativeChange : 0,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  /** Anomalies for a channel metric within [from, to) — analytics can annotate or exclude them. */
  forChannel(channelId: string, metric: string, from: Date, to: Date): Promise<MetricAnomaly[]> {
    return this.db.metricAnomaly.findMany({
      where: { channelId, metric, observedAt: { gte: from, lt: to } },
      orderBy: { observedAt: 'asc' },
      take: 1_000,
    });
  }

  /** Newest first, cursor-paginated (moderation/admin review, PHASE-26). */
  async listRecent(input: { cursor?: string; limit?: number } = {}): Promise<Page<MetricAnomaly>> {
    const limit = clampLimit(input.limit);
    const c = input.cursor ? decodeCursor(input.cursor, { id: 'uuid' }) : undefined;
    const rows = await this.db.metricAnomaly.findMany({ where: c ? { id: { lt: c.id } } : {}, orderBy: { id: 'desc' }, take: limit + 1 });
    return toPage(rows, limit, (last) => ({ id: last.id }));
  }
}
