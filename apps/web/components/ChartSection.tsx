import { Alert, Skeleton } from '@tga/ui';
import Link from 'next/link';
import { fetchStats } from '../lib/api';
import { MemberChart } from './MemberChart';

/**
 * Async chart block for use inside <Suspense>. A failure here is partial: the rest of the page
 * still renders, and the reader gets a retry link instead of an error page.
 */
export async function ChartSection({ channelId, days, table = false, retryHref }: { channelId: string; days: number; table?: boolean; retryHref: string }) {
  let stats;
  try {
    stats = await fetchStats(channelId, days);
  } catch {
    return (
      <Alert tone="warning" title="The chart could not be loaded right now." live>
        <p>
          <Link href={retryHref}>Try again</Link>
        </p>
      </Alert>
    );
  }
  if (stats.kind !== 'ok') return <Alert tone="info">Subscriber history is not available.</Alert>;
  return <MemberChart points={stats.data.points} from={stats.data.from} to={stats.data.to} title={`Subscribers, last ${days} days`} table={table} excludedAnomalies={stats.data.excludedAnomalies} />;
}

export function ChartSkeleton() {
  return <Skeleton label="Loading chart" style={{ aspectRatio: '640 / 240' }} />;
}
