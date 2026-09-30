import type { AnomalyRepository, ChannelRepository, FeatureFlagRepository } from '@tga/database';
import { type AnalyticsStore, MAX_SERIES_POINTS, type SeriesPoint } from '@tga/types';
import { CHANNEL_PAGE_FLAG } from '../channels/channel-reader';
import { FlagGate } from '../common/flag-gate';

/** Windows offered to charts (days). Anything else is rejected. */
export const STATS_WINDOWS = [7, 30, 90, 365] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];
export const DEFAULT_STATS_WINDOW: StatsWindow = 30;

const DAY = 86_400_000;
const MEMBERS = 'members';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bounds the chunked series read (MAX_SERIES_POINTS per chunk). */
const MAX_CHUNKS = 20;

export interface StatsReaderDeps {
  channels: ChannelRepository;
  flags: FeatureFlagRepository;
  store: AnalyticsStore;
  anomalies: AnomalyRepository;
  now?: () => Date;
  flagCacheMs?: number;
}

export interface DailyPoint {
  /** UTC calendar day (YYYY-MM-DD). */
  date: string;
  /** Last valid (non-anomalous) observation of that day. */
  value: string;
  observedAt: string;
}

export interface StatsView {
  channelId: string;
  metric: 'members';
  days: StatsWindow;
  from: string;
  to: string;
  /** Days without an observation are absent (never filled or interpolated). */
  points: DailyPoint[];
  excludedAnomalies: number;
  methodology: string;
}

export type StatsResult = { kind: 'ok'; view: StatsView } | { kind: 'invalid'; message: string } | { kind: 'not_found' };

/**
 * Daily subscriber series for charts (PHASE-13, API.md GET /channels/:id/stats). Reads stored
 * snapshots only; anomalous observations are excluded, gaps stay gaps. Same visibility rules
 * and feature flag as the channel page.
 */
export class StatsReader {
  private readonly gate: FlagGate;

  constructor(private readonly deps: StatsReaderDeps) {
    this.gate = new FlagGate(deps.flags, CHANNEL_PAGE_FLAG, deps.flagCacheMs);
  }

  async read(id: string, rawDays: unknown): Promise<StatsResult> {
    if (!(await this.gate.enabled())) return { kind: 'not_found' };
    if (typeof id !== 'string' || !UUID.test(id)) return { kind: 'invalid', message: 'id must be a UUID' };
    let days: StatsWindow = DEFAULT_STATS_WINDOW;
    if (rawDays !== undefined) {
      const n = typeof rawDays === 'string' && /^\d{1,3}$/.test(rawDays) ? Number(rawDays) : Number.NaN;
      if (!(STATS_WINDOWS as readonly number[]).includes(n)) return { kind: 'invalid', message: `days must be one of ${STATS_WINDOWS.join(', ')}` };
      days = n as StatsWindow;
    }

    const channel = await this.deps.channels.findById(id);
    if (!channel || channel.hiddenAt || channel.status !== 'active' || !channel.username) return { kind: 'not_found' };

    const now = this.deps.now?.() ?? new Date();
    const to = new Date(now.getTime() + 1);
    const from = new Date(now.getTime() - days * DAY);
    const [series, flagged] = await Promise.all([this.series(id, from, to), this.deps.anomalies.forChannel(id, MEMBERS, from, to)]);
    const anomalous = new Set(flagged.map((a) => a.observedAt.getTime()));

    const byDay = new Map<string, SeriesPoint>();
    let excluded = 0;
    for (const p of series) {
      if (anomalous.has(p.observedAt.getTime())) {
        excluded += 1;
        continue;
      }
      byDay.set(p.observedAt.toISOString().slice(0, 10), p); // ascending: the last one wins
    }

    return {
      kind: 'ok',
      view: {
        channelId: id,
        metric: 'members',
        days,
        from: from.toISOString(),
        to: now.toISOString(),
        points: [...byDay].map(([date, p]) => ({ date, value: p.value.toString(), observedAt: p.observedAt.toISOString() })),
        excludedAnomalies: excluded,
        methodology: 'Last valid observation per UTC day; anomalous observations excluded; days without data are omitted.',
      },
    };
  }

  /** Ascending series in bounded chunks, so dense histories are never silently truncated. */
  private async series(id: string, from: Date, to: Date): Promise<SeriesPoint[]> {
    const out: SeriesPoint[] = [];
    let cursor = from;
    for (let i = 0; i < MAX_CHUNKS; i += 1) {
      const chunk = await this.deps.store.channelSeries({ entityId: id, metric: MEMBERS, from: cursor, to, limit: MAX_SERIES_POINTS });
      out.push(...chunk);
      const last = chunk.at(-1);
      if (chunk.length < MAX_SERIES_POINTS || !last) break;
      cursor = new Date(last.observedAt.getTime() + 1);
    }
    return out;
  }
}
