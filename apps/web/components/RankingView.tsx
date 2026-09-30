import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { fetchRanking, fetchRankings, type RankingEntry, type RankingSummary } from '../lib/api';
import { formatCount, formatDate, formatSignedCount } from '../lib/format';
import { ChannelList, EmptyState } from './ChannelList';

export const loadRankings = cache(fetchRankings);
export const loadRanking = cache((key: string, cursor: string | undefined) => fetchRanking(key, cursor));

/** For generateMetadata: rankings disabled (OD-015 pending) or unknown → real 404 before streaming. */
export async function requireRankings(): Promise<RankingSummary[]> {
  const r = await loadRankings();
  if (r.kind !== 'ok') notFound();
  return r.data;
}

/** Ranked value shown next to the current count; omitted where it would repeat it. */
function formatScore(metric: string, score: number): string | undefined {
  if (metric === 'members') return undefined;
  if (metric === 'members_growth_7d') return `${formatSignedCount(String(Math.round(score)))} in 7 days`;
  return `score ${score.toFixed(2)}`;
}

export function Methodology({ r }: { r: RankingSummary }) {
  return (
    <details>
      <summary>How this ranking is calculated</summary>
      <dl className="defs small">
        <dt>Metric</dt>
        <dd>
          {r.metric}
          {r.window ? ` (window ${r.window})` : ''}
        </dd>
        <dt>Eligible</dt>
        <dd>
          {r.eligibility.minBase === '0' ? 'any channel or group with a collected count' : `at least ${formatCount(r.eligibility.minBase)} subscribers`}
          {r.eligibility.requireFresh ? ', current count no older than 1 day' : ''}
        </dd>
        <dt>Ties</dt>
        <dd>higher score first, then earliest discovered</dd>
        <dt>Version</dt>
        <dd>{r.methodologyVersion}</dd>
      </dl>
      <p className="small">
        <Link href="/docs">Full methodology</Link>
      </p>
    </details>
  );
}

export async function RankingList({ rankingKey, cursor, basePath }: { rankingKey: string; cursor?: string; basePath: string }) {
  const result = await loadRanking(rankingKey, cursor);
  if (result.kind === 'not_found') notFound(); // decided in generateMetadata
  if (result.kind === 'invalid') {
    return (
      <div className="notice" role="alert">
        <p>This page of the ranking could not be loaded.</p>
        <p>
          <Link href={basePath}>Back to the top</Link>
        </p>
      </div>
    );
  }
  const { ranking, entries, nextCursor } = result.data;
  const sep = basePath.includes('?') ? '&' : '?';
  return (
    <section aria-labelledby="ranking-title">
      <h2 id="ranking-title">{ranking.label}</h2>
      {ranking.latestRun ? (
        <p className="small muted">
          As of {formatDate(ranking.latestRun.asOf)} · {formatCount(String(ranking.latestRun.eligibleCount))} eligible
        </p>
      ) : null}
      {ranking.disclaimer ? <p className="small muted">{ranking.disclaimer}</p> : null}
      <Methodology r={ranking} />
      {entries.length === 0 ? (
        <EmptyState>
          <p>{ranking.latestRun ? 'No eligible channels in this ranking right now.' : 'This ranking has not been calculated yet.'}</p>
        </EmptyState>
      ) : (
        <ChannelList
          label={ranking.label}
          rows={entries.map((e: RankingEntry) => {
            const extra = formatScore(ranking.metric, e.score);
            return { key: `${e.position}`, position: e.position, ...e.channel, ...(extra ? { extra } : {}) };
          })}
        />
      )}
      <nav className="pager" aria-label="Pagination">
        {cursor ? <Link href={basePath}>Back to the top</Link> : null}
        {nextCursor ? (
          <Link href={`${basePath}${sep}cursor=${encodeURIComponent(nextCursor)}`} rel="next">
            Next page
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
