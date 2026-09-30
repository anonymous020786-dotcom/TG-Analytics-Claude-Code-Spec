import { RANKINGS, type RankingDefinition } from '@tga/analytics';
import { type ChannelRepository, DEFAULT_PAGE_SIZE, type FeatureFlagRepository, InvalidCursorError, MAX_PAGE_SIZE, type RankingRepository } from '@tga/database';
import { FlagGate } from '../common/flag-gate';

/**
 * Public display of rankings/trending (parameters approved as D-019). An operational switch:
 * unknown flags are off.
 */
export const RANKINGS_FLAG = 'rankings.public';

export interface RankingsReaderDeps {
  rankings: RankingRepository;
  channels: ChannelRepository;
  flags: FeatureFlagRepository;
  flagCacheMs?: number;
}

export interface RankingSummary {
  key: string;
  label: string;
  metric: string;
  window: string | null;
  methodologyVersion: string;
  eligibility: { minBase: string; requireFresh: boolean };
  tieBreak: string;
  disclaimer: string | null;
  /** Latest run, or null when none has been computed yet. */
  latestRun: { asOf: string; computedAt: string; eligibleCount: number; entryCount: number } | null;
}

export interface RankingEntryItem {
  position: number;
  score: number;
  channel: { id: string; username: string; title: string; type: string; members: { value: string; observedAt: string } | null };
}

export type RankingsResult<T> = { kind: 'ok'; value: T } | { kind: 'not_found' } | { kind: 'invalid'; code: 'invalid_query' | 'invalid_cursor'; message: string };

const summaryBase = (d: RankingDefinition) => ({
  key: d.key,
  label: d.label,
  metric: d.metric,
  window: d.window,
  methodologyVersion: d.methodologyVersion,
  eligibility: { minBase: d.eligibility.minBase.toString(), requireFresh: d.eligibility.requireFresh },
  tieBreak: d.tieBreak,
  disclaimer: d.disclaimer,
});

/**
 * Read model for rankings and trending (API.md GET /rankings, GET /trending). Serves the
 * latest immutable run of each ranking. Entities hidden or deactivated after the run are
 * skipped at read time; stored positions are kept, so a position can be missing.
 */
export class RankingsReader {
  private readonly gate: FlagGate;

  constructor(private readonly deps: RankingsReaderDeps) {
    this.gate = new FlagGate(deps.flags, RANKINGS_FLAG, deps.flagCacheMs);
  }

  async list(): Promise<RankingsResult<RankingSummary[]>> {
    if (!(await this.gate.enabled())) return { kind: 'not_found' };
    const value = await Promise.all(RANKINGS.map(async (d) => ({ ...summaryBase(d), latestRun: await this.runSummary(d.key) })));
    return { kind: 'ok', value };
  }

  async entries(key: string, params: Record<string, unknown>): Promise<RankingsResult<{ ranking: RankingSummary; items: RankingEntryItem[]; nextCursor: string | null; limit: number }>> {
    if (!(await this.gate.enabled())) return { kind: 'not_found' };
    const definition = RANKINGS.find((d) => d.key === key);
    if (!definition) return { kind: 'not_found' };
    const cursor = params.cursor;
    const rawLimit = params.limit;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 512)) return { kind: 'invalid', code: 'invalid_cursor', message: 'Invalid pagination cursor' };
    let limit = DEFAULT_PAGE_SIZE;
    if (rawLimit !== undefined) {
      const n = typeof rawLimit === 'string' && /^\d{1,4}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
      if (!(n >= 1 && n <= MAX_PAGE_SIZE)) return { kind: 'invalid', code: 'invalid_query', message: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}` };
      limit = n;
    }

    const run = await this.deps.rankings.latestRun(key);
    const ranking: RankingSummary = { ...summaryBase(definition), latestRun: run ? toRunSummary(run) : null };
    if (!run) return { kind: 'ok', value: { ranking, items: [], nextCursor: null, limit } };

    let page;
    try {
      page = await this.deps.rankings.entries(run.id, { limit, ...(typeof cursor === 'string' ? { cursor } : {}) });
    } catch (error) {
      if (error instanceof InvalidCursorError) return { kind: 'invalid', code: 'invalid_cursor', message: 'Invalid pagination cursor' };
      throw error;
    }
    const cards = new Map((await this.deps.channels.publicCards(page.items.map((e) => e.channelId))).map((c) => [c.id, c]));
    const items = page.items.flatMap((e): RankingEntryItem[] => {
      const c = cards.get(e.channelId);
      if (!c) return [];
      return [
        {
          position: e.position,
          score: e.score,
          channel: {
            id: c.id,
            username: c.username,
            title: c.title,
            type: c.type,
            members: c.memberCount !== null && c.memberCountObservedAt ? { value: c.memberCount.toString(), observedAt: c.memberCountObservedAt.toISOString() } : null,
          },
        },
      ];
    });
    return { kind: 'ok', value: { ranking, items, nextCursor: page.nextCursor, limit } };
  }

  private async runSummary(key: string): Promise<RankingSummary['latestRun']> {
    const run = await this.deps.rankings.latestRun(key);
    return run ? toRunSummary(run) : null;
  }
}

function toRunSummary(run: { asOf: Date; computedAt: Date; eligibleCount: number; entryCount: number }): NonNullable<RankingSummary['latestRun']> {
  return { asOf: run.asOf.toISOString(), computedAt: run.computedAt.toISOString(), eligibleCount: run.eligibleCount, entryCount: run.entryCount };
}
