import { Alert } from '@tga/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '../../../../components/Seo';
import { requireChannel } from '../../../../lib/channel';
import { pageMetadata } from '../../../../lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await requireChannel((await params).username, '/posts');
  return pageMetadata({ title: `Posts: ${c.title} (@${c.username})`, description: `Post data for ${c.title} (@${c.username}) is not available yet.`, path: `/channel/${c.username}/posts`, indexable: false });
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
      <Breadcrumbs
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'Channels', path: '/channels' },
          { name: c.title, path: `/channel/${c.username}` },
          { name: 'Posts', path: `/channel/${c.username}/posts` },
        ]}
      />
      <h1>Posts</h1>
      <Alert tone="info" title="Post data is not available yet.">
        <p className="small">
          Post history, views and reactions can only be read through Telegram&apos;s user API, which TG Analytics has not enabled yet. Until then no post figures are shown, rather than showing zeros.
        </p>
      </Alert>
      <p>
        <Link href={`/channel/${c.username}/statistics`}>Subscriber statistics</Link>
      </p>
    </main>
  );
}
