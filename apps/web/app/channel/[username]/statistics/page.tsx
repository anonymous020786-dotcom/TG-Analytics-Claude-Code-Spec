import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ChartSection, ChartSkeleton } from '../../../../components/ChartSection';
import { Breadcrumbs } from '../../../../components/Seo';
import { requireChannel } from '../../../../lib/channel';
import { CHART_WINDOWS, parseWindow, type SearchParams } from '../../../../lib/params';
import { clampDescription, pageMetadata } from '../../../../lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await requireChannel((await params).username, '/statistics');
  return pageMetadata({
    title: `Subscriber statistics: ${c.title} (@${c.username})`,
    description: clampDescription(`Daily subscriber history for ${c.title} (@${c.username}) over 7, 30, 90 and 365 days, with a data table. Calculated from public Telegram data.`),
    path: `/channel/${c.username}/statistics`,
    indexable: c.seo?.indexable === true,
  });
}

export default async function StatisticsPage({ params, searchParams }: Props) {
  const c = await requireChannel((await params).username, '/statistics');
  const days = parseWindow(await searchParams);
  const base = `/channel/${c.username}/statistics`;

  return (
    <main id="main" className="wrap">
      <Breadcrumbs
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'Channels', path: '/channels' },
          { name: c.title, path: `/channel/${c.username}` },
          { name: 'Statistics', path: base },
        ]}
      />
      <h1>Subscriber statistics</h1>
      <nav className="tabs" aria-label="Time range">
        {CHART_WINDOWS.map((d) => (
          <Link key={d} href={`${base}?days=${d}`} aria-current={d === days ? 'page' : undefined}>
            {d === 365 ? '1 year' : `${d} days`}
          </Link>
        ))}
      </nav>
      <Suspense key={days} fallback={<ChartSkeleton />}>
        <ChartSection channelId={c.id} days={days} table retryHref={`${base}?days=${days}`} />
      </Suspense>
      <p className="small muted">
        Counts come from the Telegram Bot API at each collection. Observations flagged as anomalies (for example a sudden drop to zero) are excluded from the chart but kept in the history.{' '}
        <Link href="/docs">Methodology</Link>
      </p>
    </main>
  );
}
