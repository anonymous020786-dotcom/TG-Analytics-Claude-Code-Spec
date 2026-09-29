import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { type ChannelView, fetchChannel } from '../../../lib/api';

// One API call per request, shared by generateMetadata and the page.
const loadChannel = cache(fetchChannel);

// Vertical slice (PHASE-11A): server-rendered from the API, never indexable until PHASE-14.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  // Resolving existence here (not only in the page) lets Next.js send a real 404 status
  // before the response starts streaming, instead of a soft 404.
  const result = await loadChannel(username);
  if (result.kind === 'not_found') notFound();
  return { title: `${result.view.title} (@${result.view.username}) — TG Analytics`, robots: { index: false, follow: false } };
}

const fmt = new Intl.NumberFormat('en');

function formatCount(value: string): string {
  return fmt.format(BigInt(value));
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

function Growth({ label, g }: { label: string; g: ChannelView['growth']['7d'] }) {
  if (!g.available) {
    return (
      <p>
        {label}: <span title={g.reason}>not enough history yet</span>
      </p>
    );
  }
  const sign = BigInt(g.absolute) > 0n ? '+' : '';
  const pct = g.percentage === null ? '' : ` (${g.percentage >= 0 ? '+' : ''}${g.percentage.toFixed(2)}%)`;
  return (
    <p>
      {label}: {sign}
      {formatCount(g.absolute)}
      {pct}
    </p>
  );
}

export default async function ChannelPage({ params }: Props) {
  const { username } = await params;
  const result = await loadChannel(username);
  if (result.kind === 'not_found') notFound();
  const c = result.view;
  // Old username (alias): send the visitor to the current one.
  if (c.requestedAlias) permanentRedirect(`/channel/${c.username}`);

  return (
    <main>
      <header>
        <p>{c.type === 'group' ? 'Public group' : 'Public channel'}</p>
        <h1>{c.title}</h1>
        <p>@{c.username}</p>
        {c.description ? <p>{c.description}</p> : null}
      </header>

      <section aria-labelledby="metrics">
        <h2 id="metrics">Subscribers</h2>
        {c.members ? <p>{formatCount(c.members.value)}</p> : <p>Not collected yet</p>}
        <Growth label="Last 24 hours" g={c.growth['1d']} />
        <Growth label="Last 7 days" g={c.growth['7d']} />
      </section>

      <section aria-labelledby="freshness">
        <h2 id="freshness">Data freshness</h2>
        <p>Status: {c.quality.verdict}</p>
        <p>Subscriber count updated {formatAge(c.quality.members.ageSeconds)}</p>
        <p>Profile updated {formatAge(c.quality.metadata.ageSeconds)}</p>
      </section>

      <footer>
        <p>{c.disclaimer}</p>
      </footer>
    </main>
  );
}
