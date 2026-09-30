import { Alert, CursorPager, DefinitionList, EmptyState } from '@tga/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { fetchRanking, fetchRankings, type RankingEntry, type RankingSummary } from '../lib/api';
import { formatCount, formatDate, formatSignedCount } from '../lib/format';
import { ChannelList } from './ChannelList';

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
      <DefinitionList
        items={[
          { key: 'metric', term: 'Metric', description: `${r.metric}${r.window ? ` (window ${r.window})` : ''}` },
          {
            key: 'eligible',
            term: 'Eligible',
            description: `${r.eligibility.minBase === '0' ? 'any channel or group with a collected count' : `at least ${formatCount(r.eligibility.minBase)} subscribers`}${r.eligibility.requireFresh ? ', current count no older than 1 day' : ''}`,
          },
          { key: 'ties', term: 'Ties', description: 'higher score first, then earliest discovered' },
          { key: 'version', term: 'Version', description: r.methodologyVersion },
        ]}
      />
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
      <Alert tone="error" title="This page of the ranking could not be loaded." live>
        <p>
          <Link href={basePath}>Back to the top</Link>
        </p>
      </Alert>
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
        <EmptyState title={ranking.latestRun ? 'No eligible channels in this ranking right now.' : 'This ranking has not been calculated yet.'} />
      ) : (
        <ChannelList
          label={ranking.label}
          rows={entries.map((e: RankingEntry) => {
            const extra = formatScore(ranking.metric, e.score);
            return { key: `${e.position}`, position: e.position, ...e.channel, ...(extra ? { extra } : {}) };
          })}
        />
      )}
      <CursorPager
        Link={Link}
        firstLabel="Back to the top"
        {...(cursor ? { firstHref: basePath } : {})}
        {...(nextCursor ? { nextHref: `${basePath}${sep}cursor=${encodeURIComponent(nextCursor)}` } : {})}
      />
    </section>
  );
}
