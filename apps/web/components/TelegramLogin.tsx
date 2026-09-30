'use client';

import { Alert, Skeleton } from '@tga/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type State = { kind: 'loading' } | { kind: 'ready'; bot: string; csrf: string } | { kind: 'signing-in' } | { kind: 'unavailable' } | { kind: 'error'; message: string };

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

const WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';

/**
 * Sign in with Telegram (D-021). Uses the official Login Widget in callback mode: the signed
 * payload is POSTed with a CSRF token (never the redirect mode, which would create a session
 * from a GET request). The API verifies the signature; nothing here is trusted.
 */
export function TelegramLogin({ next }: { next: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/session', { credentials: 'same-origin', headers: { accept: 'application/json' } });
        if (res.status === 404) return !cancelled && setState({ kind: 'unavailable' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: { authenticated: boolean; csrfToken: string; loginBot: { username: string } } };
        if (body.data.authenticated) return router.replace(next);
        if (!cancelled) setState({ kind: 'ready', bot: body.data.loginBot.username, csrf: body.data.csrfToken });
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'Sign-in could not be started. Check your connection and reload the page.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  useEffect(() => {
    if (state.kind !== 'ready' || !slot.current) return;
    const csrf = state.csrf;
    window.onTelegramAuth = async (user) => {
      setState({ kind: 'signing-in' });
      try {
        const res = await fetch('/api/v1/auth/telegram', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify(user),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          return setState({ kind: 'error', message: body?.error?.message ?? 'Sign-in failed. Please try again.' });
        }
        router.replace(next);
        router.refresh();
      } catch {
        setState({ kind: 'error', message: 'Sign-in failed. Check your connection and try again.' });
      }
    };
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.setAttribute('data-telegram-login', state.bot);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    const host = slot.current;
    host.replaceChildren(script);
    return () => {
      host.replaceChildren();
      delete window.onTelegramAuth;
    };
  }, [state, next, router]);

  if (state.kind === 'unavailable') {
    return (
      <Alert tone="info" title="Sign-in is not available yet.">
        <p>Accounts are coming soon.</p>
      </Alert>
    );
  }
  return (
    <div>
      {state.kind === 'loading' || state.kind === 'signing-in' ? <Skeleton label={state.kind === 'signing-in' ? 'Signing in' : 'Loading sign-in'} style={{ height: 48, maxWidth: 280 }} /> : null}
      {state.kind === 'error' ? (
        <Alert tone="error" title="Sign-in failed." live>
          <p>{state.message}</p>
        </Alert>
      ) : null}
      <div ref={slot} hidden={state.kind !== 'ready'} />
    </div>
  );
}
