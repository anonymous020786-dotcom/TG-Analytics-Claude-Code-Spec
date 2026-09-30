import { assessChannelQuality, GROWTH_WINDOWS, growth, type Growth, type GrowthWindow, type Point } from '@tga/analytics';
import type { AnomalyRepository, ChannelRepository, FeatureFlagRepository } from '@tga/database';
import type { AnalyticsStore } from '@tga/types';
import { PUBLIC_USERNAME } from '@tga/validation';

/** Feature flag guarding the vertical slice (PHASE-11A). Unknown flags are off (fail closed). */
export const CHANNEL_PAGE_FLAG = 'slice.channel-page';

export interface ChannelReaderDeps {
  channels: ChannelRepository;
  flags: FeatureFlagRepository;
  store: AnalyticsStore;
  anomalies: AnomalyRepository;
  intervals: { metricsMs: number; metadataMs: number };
  now?: () => Date;
  /** How long a flag lookup is cached in-process. */
  flagCacheMs?: number;
  /** Search-engine indexability (PHASE-14); absent → never indexable. */
  indexable?: (channelId: string) => Promise<boolean>;
}

type GrowthView = { available: true; absolute: string; percentage: number | null; previousAt: string; methodologyVersion: string } | { available: false; reason: string; methodologyVersion: string };

export interface ChannelView {
  id: string;
  username: string;
  /** Set when the request used an old username (alias): clients should use this one. */
  requestedAlias: string | null;
  type: string;
  title: string;
  description: string | null;
  members: { value: string; observedAt: string } | null;
  growth: Record<'1d' | '7d', GrowthView>;
  quality: {
    verdict: string;
    members: { state: string; ageSeconds: number | null };
    metadata: { state: string; ageSeconds: number | null };
    lastCollectionErrorClass: string | null;
  };
  /** Whether search engines may index this entity page (master flag AND data rule, OD-008). */
  seo: { indexable: boolean };
  disclaimer: string;
}

export type ReadResult = { kind: 'ok'; view: ChannelView } | { kind: 'invalid' } | { kind: 'not_found' };

const DAY = 86_400_000;
const MEMBERS = 'members';
const DISCLAIMER = 'Calculated by TG Analytics from public Telegram data; not official Telegram statistics.';

function toGrowthView(g: Growth): GrowthView {
  return g.available
    ? { available: true, absolute: g.absolute.toString(), percentage: g.percentage, previousAt: g.previousAt.toISOString(), methodologyVersion: g.methodologyVersion }
    : { available: false, reason: g.reason, methodologyVersion: g.methodologyVersion };
}

const ageSeconds = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1_000));

/**
 * Read model for one public channel/group page (PHASE-11A). Never calls Telegram; reads
 * stored snapshots and computes growth/freshness with the shared pure analytics.
 * Hidden, non-active or unknown entities are `not_found` (DATA-POLICY §6, OD-004), and so is
 * everything while the feature flag is off.
 */
export class ChannelReader {
  private flagCache: { value: boolean; at: number } | undefined;

  constructor(private readonly deps: ChannelReaderDeps) {}

  async read(rawUsername: string): Promise<ReadResult> {
    const requested = rawUsername.trim().replace(/^@/, '').toLowerCase();
    if (!PUBLIC_USERNAME.test(requested)) return { kind: 'invalid' };
    if (!(await this.enabled())) return { kind: 'not_found' };

    const channel = await this.deps.channels.findByUsername(requested);
    if (!channel || channel.hiddenAt || channel.status !== 'active' || !channel.username) return { kind: 'not_found' };

    const now = this.deps.now?.() ?? new Date();
    const from = new Date(now.getTime() - 9 * DAY);
    const to = new Date(now.getTime() + 1);
    const [series, flagged, quality, indexable] = await Promise.all([
      this.deps.store.channelSeries({ entityId: channel.id, metric: MEMBERS, from, to }),
      this.deps.anomalies.forChannel(channel.id, MEMBERS, from, to),
      this.deps.channels.qualityView(channel.id),
      this.deps.indexable ? this.deps.indexable(channel.id) : Promise.resolve(false),
    ]);
    const anomalous = new Set(flagged.map((a) => a.observedAt.getTime()));
    const points: Point[] = series.map((p) => ({ value: p.value, observedAt: p.observedAt, anomalous: anomalous.has(p.observedAt.getTime()) }));
    const latest = [...points].reverse().find((p) => !p.anomalous);
    const q = assessChannelQuality(
      quality ?? { status: channel.status, collectionStatus: channel.collectionStatus, lastCollectionErrorClass: null, memberCountObservedAt: null, metadataObservedAt: null },
      this.deps.intervals,
      now,
    );
    const g = (w: GrowthWindow) => toGrowthView(growth(points, now, GROWTH_WINDOWS[w]));

    return {
      kind: 'ok',
      view: {
        id: channel.id,
        username: channel.username,
        requestedAlias: requested === channel.username ? null : requested,
        type: channel.type,
        title: channel.title,
        description: channel.description,
        members: latest ? { value: latest.value.toString(), observedAt: latest.observedAt.toISOString() } : null,
        growth: { '1d': g('1d'), '7d': g('7d') },
        quality: {
          verdict: q.verdict,
          members: { state: q.members.state, ageSeconds: ageSeconds(q.members.ageMs) },
          metadata: { state: q.metadata.state, ageSeconds: ageSeconds(q.metadata.ageMs) },
          lastCollectionErrorClass: q.lastCollectionErrorClass,
        },
        seo: { indexable },
        disclaimer: DISCLAIMER,
      },
    };
  }

  private async enabled(): Promise<boolean> {
    const ttl = this.deps.flagCacheMs ?? 15_000;
    const nowMs = Date.now();
    if (this.flagCache && nowMs - this.flagCache.at < ttl) return this.flagCache.value;
    const value = await this.deps.flags.isEnabled(CHANNEL_PAGE_FLAG);
    this.flagCache = { value, at: nowMs };
    return value;
  }
}
