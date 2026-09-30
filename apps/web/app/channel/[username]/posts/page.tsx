import type { Metadata } from 'next';
import Link from 'next/link';
import { requireChannel } from '../../../../lib/channel';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await requireChannel((await params).username, '/posts');
  return { title: `Posts: ${c.title} (@${c.username})`, robots: { index: false, follow: false } };
}

/**
 * Post history and views are only available through Telegram's user (MTProto) API, which is not
 * set up yet (OD-003, CAPABILITY-MATRIX). The page states that plainly instead of showing an
 * empty list, which would read as "no posts".
 */
export default async function PostsPage({ params }: Props) {
  const c = await requireChannel((await params).username, '/posts');
  return (
    <main id="main" className="wrap">
      <p className="kicker">
        <Link href={`/channel/${c.username}`}>{c.title}</Link>
      </p>
      <h1>Posts</h1>
      <div className="notice">
        <p>Post data is not available yet.</p>
        <p className="small">
          Post history, views and reactions can only be read through Telegram&apos;s user API, which TG Analytics has not enabled yet. Until then no post figures are shown, rather than showing zeros.
        </p>
      </div>
      <p>
        <Link href={`/channel/${c.username}/statistics`}>Subscriber statistics</Link>
      </p>
    </main>
  );
}
