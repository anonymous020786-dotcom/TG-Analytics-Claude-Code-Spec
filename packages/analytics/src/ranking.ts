/**
 * Rankings (RANKINGS.md) and trending (TRENDING.md). Pure: callers supply candidates with
 * precomputed values. Every definition declares metric, window, eligible population,
 * freshness rule, tie-break and methodology version.
 */

export interface RankingCandidate {
  entityId: string;
  /** Stable tie-break key: the channel id (UUID v7), so ties go to the earliest-discovered channel. */
  tieBreakKey: string;
  /** Score for this ranking; null = not rankable (unavailable input). */
  score: number | null;
  /** Base value used for eligibility (e.g. current members). */
  base: bigint | null;
  fresh: boolean;
}

export interface RankingDefinition {
  key: string;
  label: string;
  metric: string;
  window: string | null;
  eligibility: { minBase: bigint; requireFresh: boolean };
  /** Always: higher score first, then tieBreakKey ascending (deterministic). */
  tieBreak: 'score_desc_then_key_asc';
  methodologyVersion: string;
  /** Maximum stored entries per run (bounded). */
  limit: number;
  /** Shown with the ranking (TRENDING.md: a calculated signal, not official Telegram data). */
  disclaimer: string | null;
}

const DISCLAIMER = 'Calculated by TG Analytics from public data; not an official Telegram ranking.';

/**
 * Initial definitions (methodology v1). Eligibility bases and trending weights are proposals
 * approved by the owner (D-019) and are versioned: any change bumps the version.
 */
export const RANKINGS: readonly RankingDefinition[] = [
  {
    key: 'top-subscribers',
    label: 'Most subscribers',
    metric: 'members',
    window: null,
    eligibility: { minBase: 0n, requireFresh: true },
    tieBreak: 'score_desc_then_key_asc',
    methodologyVersion: 'rank-members-v1',
    limit: 1_000,
    disclaimer: DISCLAIMER,
  },
  {
    key: 'fastest-growing-7d',
    label: 'Fastest growing (7 days, absolute)',
    metric: 'members_growth_7d',
    window: '7d',
    eligibility: { minBase: 1_000n, requireFresh: true },
    tieBreak: 'score_desc_then_key_asc',
    methodologyVersion: 'rank-growth7d-v1',
    limit: 1_000,
    disclaimer: DISCLAIMER,
  },
  {
    key: 'trending',
    label: 'Trending',
    metric: 'trending_score',
    window: '1d+7d',
    eligibility: { minBase: 1_000n, requireFresh: true },
    tieBreak: 'score_desc_then_key_asc',
    methodologyVersion: 'trending-v1',
    limit: 1_000,
    disclaimer: DISCLAIMER,
  },
];

export interface RankedEntry {
  position: number;
  entityId: string;
  score: number;
}

export interface RankingResult {
  entries: RankedEntry[];
  /** Candidates that met eligibility and had a score. */
  eligibleCount: number;
  methodologyVersion: string;
}

export function rank(definition: RankingDefinition, candidates: readonly RankingCandidate[]): RankingResult {
  const eligible = candidates.filter(
    (c) =>
      c.score !== null &&
      Number.isFinite(c.score) &&
      c.base !== null &&
      c.base >= definition.eligibility.minBase &&
      (!definition.eligibility.requireFresh || c.fresh),
  );
  eligible.sort((a, b) => (b.score as number) - (a.score as number) || (a.tieBreakKey < b.tieBreakKey ? -1 : a.tieBreakKey > b.tieBreakKey ? 1 : 0));
  return {
    entries: eligible.slice(0, definition.limit).map((c, i) => ({ position: i + 1, entityId: c.entityId, score: c.score as number })),
    eligibleCount: eligible.length,
    methodologyVersion: definition.methodologyVersion,
  };
}

/** trending-v1 weights (TRENDING.md: documented and versioned). Approved as D-019. */
export const TRENDING_V1 = { version: 'trending-v1', weight1d: 0.7, weight7d: 0.3 } as const;

/**
 * trending-v1 = 0.7 × growth% (1d) + 0.3 × growth% (7d). Uses only inputs available today
 * (member growth); view velocity/engagement join in a later version once MTProto data exists.
 * Unavailable when either input is unavailable (no partial fabrication).
 */
export function trendingScoreV1(growthPct1d: number | null, growthPct7d: number | null): number | null {
  if (growthPct1d === null || growthPct7d === null) return null;
  return TRENDING_V1.weight1d * growthPct1d + TRENDING_V1.weight7d * growthPct7d;
}
