import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ChartSection, ChartSkeleton } from '../../../components/ChartSection';
import type { ChannelView } from '../../../lib/api';
import { requireChannel } from '../../../lib/channel';
import { formatAge, formatCount, formatPercent, formatSignedCount } from '../../../lib/format';

// Server-rendered from the API, never indexable until PHASE-14.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await requireChannel((await params).username);
  return { title: `${c.title} (@${c.username})`, robots: { index: false, follow: false } };
}

function Growth({ label, g }: { label: string; g: ChannelView['growth']['7d'] }) {
  return (
    <div className="card">
      <h3>{label}</h3>
      {g.available ? (
        <p className="big-number">
          {formatSignedCount(g.absolute)} <span className="small muted">{formatPercent(g.percentage) ?? ''}</span>
        </p>
      ) : (
        <p className="muted" title={g.reason}>
          Not enough history yet
        </p>
      )}
    </div>
  );
}

const VERDICT: Record<string, string> = { ok: 'Up to date', stale: 'Out of date', failing: 'Collection failing', never_collected: 'Not collected yet', unavailable: 'Not available' };

export default async function ChannelPage({ params }: Props) {
  const c = await requireChannel((await params).username);

  return (
    <main id="main" className="wrap">
      {/* 1. Identity */}
      <header>
        <p className="kicker">{c.type === 'group' ? 'Public group' : 'Public channel'}</p>
        <h1>{c.title}</h1>
        <p className="muted">@{c.username}</p>
        {c.description ? <p>{c.description}</p> : null}
      </header>

      {/* 2. Primary metrics and 3. growth */}
      <section aria-labelledby="metrics">
        <h2 id="metrics">Subscribers</h2>
        <div className="stats-row">
          <div className="card">
            <h3>Current</h3>
            {c.members ? <p className="big-number">{formatCount(c.members.value)}</p> : <p className="muted">Not collected yet</p>}
            <p className="small muted">Updated {formatAge(c.quality.members.ageSeconds)}</p>
          </div>
          <Growth label="Last 24 hours" g={c.growth['1d']} />
          <Growth label="Last 7 days" g={c.growth['7d']} />
        </div>
        <Suspense fallback={<ChartSkeleton />}>
          <ChartSection channelId={c.id} days={30} retryHref={`/channel/${c.username}`} />
        </Suspense>
        <p>
          <Link href={`/channel/${c.username}/statistics`}>Full statistics</Link>
        </p>
      </section>

      {/* 4. Post analytics and 5. recent posts: not collected until MTProto access exists (OD-003). */}
      <section aria-labelledby="posts">
        <h2 id="posts">Posts</h2>
        <div className="notice">
          <p>Post analytics and recent posts are not available yet. Collecting them requires Telegram access that is still being set up.</p>
          <p className="small">
            <Link href={`/channel/${c.username}/posts`}>About post data</Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="freshness">
        <h2 id="freshness">Data freshness</h2>
        <dl className="defs">
          <dt>Status</dt>
          <dd>{VERDICT[c.quality.verdict] ?? c.quality.verdict}</dd>
          <dt>Subscriber count</dt>
          <dd>updated {formatAge(c.quality.members.ageSeconds)}</dd>
          <dt>Profile</dt>
          <dd>updated {formatAge(c.quality.metadata.ageSeconds)}</dd>
        </dl>
        <p className="small muted">
          {c.disclaimer} <Link href="/docs">Methodology</Link>
        </p>
      </section>
    </main>
  );
}
