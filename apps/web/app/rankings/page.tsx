import type { Metadata } from 'next';
import Link from 'next/link';
import { RankingList, requireRankings } from '../../components/RankingView';
import { indexingEnabled } from '../../lib/api';
import { one, type SearchParams } from '../../lib/params';
import { pageMetadata } from '../../lib/seo';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const rankings = await requireRankings();
  const params = await searchParams;
  const selected = rankings.find((r) => r.key === one(params, 'ranking')) ?? rankings[0];
  const isDefault = selected?.key === rankings[0]?.key;
  return pageMetadata({
    title: selected && !isDefault ? `Rankings: ${selected.label}` : 'Rankings',
    description: `${selected?.label ?? 'Rankings'} of public Telegram channels and groups, with methodology and data freshness. Not an official Telegram ranking.`,
    path: isDefault || !selected ? '/rankings' : `/rankings?ranking=${selected.key}`,
    indexable: !one(params, 'cursor') && (await indexingEnabled()),
  });
}

export default async function RankingsPage({ searchParams }: Props) {
  const rankings = await requireRankings();
  const params = await searchParams;
  const selected = rankings.find((r) => r.key === one(params, 'ranking')) ?? rankings[0];
  const cursor = one(params, 'cursor');
  return (
    <main id="main" className="wrap">
      <h1>Rankings</h1>
      <nav className="tabs" aria-label="Rankings">
        {rankings.map((r) => (
          <Link key={r.key} href={`/rankings?ranking=${r.key}`} aria-current={r.key === selected?.key ? 'page' : undefined}>
            {r.label}
          </Link>
        ))}
      </nav>
      {selected ? <RankingList rankingKey={selected.key} basePath={`/rankings?ranking=${selected.key}`} {...(cursor && /^[A-Za-z0-9_-]{1,512}$/.test(cursor) ? { cursor } : {})} /> : null}
    </main>
  );
}
