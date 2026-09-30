import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RankingList, requireRankings } from '../../components/RankingView';
import { one, type SearchParams } from '../../lib/params';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const rankings = await requireRankings();
  if (!rankings.some((r) => r.key === 'trending')) notFound();
  return { title: 'Trending' };
}

/** Trending is a calculated signal, not official Telegram data (TRENDING.md, FR-TRND-01). */
export default async function TrendingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const cursor = one(await searchParams, 'cursor');
  return (
    <main id="main" className="wrap">
      <h1>Trending</h1>
      <p className="muted">A calculated signal combining recent subscriber growth. Not official Telegram data.</p>
      <RankingList rankingKey="trending" basePath="/trending" {...(cursor && /^[A-Za-z0-9_-]{1,512}$/.test(cursor) ? { cursor } : {})} />
    </main>
  );
}
