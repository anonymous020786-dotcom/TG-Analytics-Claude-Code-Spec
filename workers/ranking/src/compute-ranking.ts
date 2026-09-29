import { GROWTH_WINDOWS, growth, type GrowthOptions, rank, RANKINGS, type RankingCandidate, trendingScoreV1 } from '@tga/analytics';
import type { ChannelRepository, RankingRepository } from '@tga/database';
import { JobError } from '@tga/queues';
import type { AnalyticsStore, SeriesPoint } from '@tga/types';

export interface RankingDeps {
  channels: ChannelRepository;
  store: AnalyticsStore;
  rankings: RankingRepository;
}

const MEMBERS = 'members';
const BATCH = 500;

/** Growth for one channel from the batched current/baseline points, with the same rules as growth(). */
function growthFrom(current: SeriesPoint | undefined, baseline: SeriesPoint | undefined, asOf: Date, window: GrowthOptions) {
  const points = [current, baseline].filter((p): p is SeriesPoint => !!p).map((p) => ({ value: p.value, observedAt: p.observedAt }));
  return growth(points, asOf, window);
}

async function baselines(store: AnalyticsStore, ids: string[], asOf: Date, window: GrowthOptions) {
  const start = asOf.getTime() - window.windowMs;
  return store.latestChannelValues(MEMBERS, ids, new Date(start), new Date(start - window.baselineToleranceMs));
}

/**
 * ranking.compute (PHASE-11). Scores every eligible channel for one ranking definition as of
 * `asOf`, ranks them (pure `rank`) and stores an immutable run. Idempotent: re-running the
 * same (ranking, version, asOf) returns the existing run. Reads are batched (no N+1).
 */
export async function computeRanking(deps: RankingDeps, rankingKey: string, asOf: Date): Promise<{ runId: string; created: boolean; entries: number; eligible: number }> {
  const definition = RANKINGS.find((r) => r.key === rankingKey);
  if (!definition) throw new JobError('invalid_input', 'unknown_ranking', `Unknown ranking "${rankingKey}"`);

  const w1 = GROWTH_WINDOWS['1d'];
  const w7 = GROWTH_WINDOWS['7d'];
  const candidates: RankingCandidate[] = [];
  let after: string | undefined;
  for (;;) {
    const batch = await deps.channels.rankable(after, BATCH);
    if (batch.length === 0) break;
    after = batch.at(-1)?.id;
    const ids = batch.map((c) => c.id);
    const current = await deps.store.latestChannelValues(MEMBERS, ids, asOf, new Date(asOf.getTime() - w7.maxCurrentAgeMs));
    const base7 = definition.key === 'top-subscribers' ? new Map<string, SeriesPoint>() : await baselines(deps.store, ids, asOf, w7);
    const base1 = definition.key === 'trending' ? await baselines(deps.store, ids, asOf, w1) : new Map<string, SeriesPoint>();

    for (const channel of batch) {
      const cur = current.get(channel.id);
      let score: number | null = null;
      if (definition.key === 'top-subscribers') {
        score = cur ? Number(cur.value) : null;
      } else if (definition.key === 'fastest-growing-7d') {
        const g = growthFrom(cur, base7.get(channel.id), asOf, w7);
        score = g.available ? Number(g.absolute) : null;
      } else if (definition.key === 'trending') {
        const g1 = growthFrom(cur, base1.get(channel.id), asOf, w1);
        const g7 = growthFrom(cur, base7.get(channel.id), asOf, w7);
        score = trendingScoreV1(g1.available ? g1.percentage : null, g7.available ? g7.percentage : null);
      }
      candidates.push({ entityId: channel.id, tieBreakKey: channel.id, score, base: cur?.value ?? null, fresh: !!cur });
    }
  }

  const result = rank(definition, candidates);
  const saved = await deps.rankings.saveRun({
    rankingKey: definition.key,
    methodologyVersion: result.methodologyVersion,
    asOf,
    eligibleCount: result.eligibleCount,
    entries: result.entries.map((e) => ({ position: e.position, channelId: e.entityId, score: e.score })),
  });
  return { ...saved, entries: result.entries.length, eligible: result.eligibleCount };
}
