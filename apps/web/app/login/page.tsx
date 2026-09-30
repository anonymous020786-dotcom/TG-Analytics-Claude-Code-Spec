import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TelegramLogin } from '../../components/TelegramLogin';
import { currentUser } from '../../lib/auth';
import { safeNext } from '../../lib/next-path';
import type { SearchParams } from '../../lib/params';
import { pageMetadata } from '../../lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Decided before streaming: disabled sign-in is a real 404 (UI-UX.md).
  if ((await currentUser()).kind === 'disabled') notFound();
  return pageMetadata({ title: 'Sign in', description: 'Sign in to TG Analytics with your Telegram account.', path: '/login', indexable: false });
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const next = safeNext((await searchParams).next);
  const me = await currentUser();
  // Also here, not only in generateMetadata: Next streams metadata for regular browsers, so
  // only a notFound() thrown while rendering the page sets the 404 status.
  if (me.kind === 'disabled') notFound();
  if (me.kind === 'user') redirect(next);
  return (
    <main id="main" className="wrap">
      <h1>Sign in</h1>
      <p>Sign in with your Telegram account. There is no separate password.</p>
      <TelegramLogin next={next} />
      <h2>What we store</h2>
      <p className="muted">
        Your Telegram user ID, name and username, so we can recognise you next time. We do not receive your phone number and we do not store your photo. You can sign out of every device from your account page.
      </p>
      <p className="small">
        <Link href="/docs">How TG Analytics works</Link>
      </p>
    </main>
  );
}
