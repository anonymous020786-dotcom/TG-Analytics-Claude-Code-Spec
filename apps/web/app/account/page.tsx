import { DefinitionList } from '@tga/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Sessions } from '../../components/Sessions';
import { SignOut } from '../../components/SignOut';
import { currentUser } from '../../lib/auth';
import { pageMetadata } from '../../lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  if ((await currentUser()).kind === 'disabled') notFound();
  return pageMetadata({ title: 'Your account', description: 'Your TG Analytics account.', path: '/account', indexable: false });
}

/** Display only: every account operation is authorized by the API, not by this page. */
export default async function AccountPage() {
  const me = await currentUser();
  if (me.kind === 'disabled') notFound(); // in the page too (metadata is streamed)
  if (me.kind !== 'user') redirect('/login?next=/account');
  const u = me.user;
  return (
    <main id="main" className="wrap">
      <h1>Your account</h1>
      <DefinitionList
        items={[
          { key: 'name', term: 'Name', description: [u.firstName, u.lastName].filter(Boolean).join(' ') },
          { key: 'username', term: 'Telegram username', description: u.username ? `@${u.username}` : 'none' },
          { key: 'signin', term: 'Sign-in method', description: 'Telegram' },
          { key: 'roles', term: 'Roles', description: me.roles.length ? me.roles.map((r) => (r === 'admin' ? 'Administrator' : r)).join(', ') : 'Member' },
        ]}
      />
      <h2>Sessions</h2>
      <p className="muted">Devices where you are signed in. End any session you do not recognise.</p>
      <Sessions />
      <p className="muted">Signing out everywhere ends every session on every device, including this one.</p>
      <SignOut />
    </main>
  );
}
