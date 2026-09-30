import { Alert, DefinitionList, FreshnessBadge, StatCard, StatGrid } from '@tga/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ChartSection, ChartSkeleton } from '../../../components/ChartSection';
import { Breadcrumbs, JsonLd } from '../../../components/Seo';
import type { ChannelView } from '../../../lib/api';
import { requireChannel } from '../../../lib/channel';
import { formatAge, formatCount, formatPercent, formatSignedCount } from '../../../lib/format';
import { channelDescription, channelJsonLd, pageMetadata } from '../../../lib/seo';

// Server-rendered from the API, never indexable until PHASE-14.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await requireChannel((await params).username);
  return pageMetadata({ title: `${c.title} (@${c.username})`, description: channelDescription(c), path: `/channel/${c.username}`, indexable: c.seo?.indexable === true });
}

/** Growth is shown only when calculable; otherwise the card says why (never 0). */
function Growth({ label, g }: { label: string; g: ChannelView['growth']['7d'] }) {
  return (
    <StatCard
      label={label}
      value={
        g.available ? (
          <>
            {formatSignedCount(g.absolute)} <span className="small muted">{formatPercent(g.percentage) ?? ''}</span>
          </>
        ) : null
      }
      unavailable="Not enough history yet"
    />
  );
}

export default async function ChannelPage({ params }: Props) {
  const c = await requireChannel((await params).username);

  return (
    <main id="main" className="wrap">
      <Breadcrumbs crumbs={[{ name: 'Home', path: '/' }, { name: 'Channels', path: '/channels' }, { name: c.title, path: `/channel/${c.username}` }]} />
      <JsonLd data={channelJsonLd(c, `/channel/${c.username}`)} />
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
        <StatGrid>
          <StatCard label="Current" value={c.members ? formatCount(c.members.value) : null} unavailable="Not collected yet" detail={`Updated ${formatAge(c.quality.members.ageSeconds)}`} />
          <Growth label="Last 24 hours" g={c.growth['1d']} />
          <Growth label="Last 7 days" g={c.growth['7d']} />
        </StatGrid>
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
        <Alert tone="info" title="Not available yet">
          <p>Post analytics and recent posts are not available yet. Collecting them requires Telegram access that is still being set up.</p>
          <p className="small">
            <Link href={`/channel/${c.username}/posts`}>About post data</Link>
          </p>
        </Alert>
      </section>

      <section aria-labelledby="freshness">
        <h2 id="freshness">Data freshness</h2>
        <DefinitionList
          items={[
            { key: 'status', term: 'Status', description: <FreshnessBadge verdict={c.quality.verdict} /> },
            { key: 'members', term: 'Subscriber count', description: `updated ${formatAge(c.quality.members.ageSeconds)}` },
            { key: 'profile', term: 'Profile', description: `updated ${formatAge(c.quality.metadata.ageSeconds)}` },
          ]}
        />
        <p className="small muted">
          {c.disclaimer} <Link href="/docs">Methodology</Link>
        </p>
      </section>
    </main>
  );
}
