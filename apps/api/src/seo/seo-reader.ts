import { type ChannelRepository, type FeatureFlagRepository, type IndexabilityPolicy, InvalidCursorError, MAX_SITEMAP_PAGE } from '@tga/database';
import { FlagGate } from '../common/flag-gate';

/**
 * Master switch for search-engine indexing (PHASE-14). Off by default: every page is noindex,
 * robots.txt disallows everything and the sitemap is empty. Turn on only after OD-008 (the
 * indexation threshold) is approved and a production domain exists (OD-016).
 */
export const SEO_INDEXING_FLAG = 'seo.indexing';

export interface SeoReaderDeps {
  channels: ChannelRepository;
  flags: FeatureFlagRepository;
  policy: IndexabilityPolicy;
  now?: () => Date;
  flagCacheMs?: number;
}

export type SitemapResult = { kind: 'ok'; value: { items: { username: string; lastModified: string }[]; nextCursor: string | null } } | { kind: 'invalid'; message: string };

export class SeoReader {
  private readonly gate: FlagGate;

  constructor(private readonly deps: SeoReaderDeps) {
    this.gate = new FlagGate(deps.flags, SEO_INDEXING_FLAG, deps.flagCacheMs);
  }

  async settings(): Promise<{ indexing: boolean; policy: { minMembers: string; minHistoryDays: number; maxAgeHours: number } }> {
    const p = this.deps.policy;
    return { indexing: await this.gate.enabled(), policy: { minMembers: p.minMembers.toString(), minHistoryDays: p.minHistoryDays, maxAgeHours: Math.round(p.maxAgeMs / 3_600_000) } };
  }

  /** Master switch AND the data rule. Anything unexpected is treated as not indexable. */
  async channelIndexable(channelId: string): Promise<boolean> {
    if (!(await this.gate.enabled())) return false;
    return this.deps.channels.isIndexable(channelId, this.deps.policy, this.deps.now?.() ?? new Date());
  }

  async sitemapChannels(params: Record<string, unknown>): Promise<SitemapResult> {
    const cursor = params.cursor;
    const rawLimit = params.limit;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 512)) return { kind: 'invalid', message: 'Invalid pagination cursor' };
    let limit = MAX_SITEMAP_PAGE;
    if (rawLimit !== undefined) {
      const n = typeof rawLimit === 'string' && /^\d{1,5}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
      if (!(n >= 1 && n <= MAX_SITEMAP_PAGE)) return { kind: 'invalid', message: `limit must be an integer between 1 and ${MAX_SITEMAP_PAGE}` };
      limit = n;
    }
    if (!(await this.gate.enabled())) return { kind: 'ok', value: { items: [], nextCursor: null } };
    try {
      const page = await this.deps.channels.indexablePage(this.deps.policy, { limit, ...(typeof cursor === 'string' ? { cursor } : {}) }, this.deps.now?.() ?? new Date());
      return { kind: 'ok', value: { items: page.items.map((i) => ({ username: i.username, lastModified: i.lastModified.toISOString() })), nextCursor: page.nextCursor } };
    } catch (error) {
      if (error instanceof InvalidCursorError) return { kind: 'invalid', message: 'Invalid pagination cursor' };
      throw error;
    }
  }
}
