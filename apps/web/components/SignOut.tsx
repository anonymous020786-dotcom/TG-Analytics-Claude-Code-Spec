'use client';

import { Alert, Button } from '@tga/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Sign out of this browser or of every session. CSRF token is fetched right before the POST. */
export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'one' | 'all'>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut(everywhere: boolean) {
    setBusy(everywhere ? 'all' : 'one');
    setError(null);
    try {
      const boot = await fetch('/api/v1/auth/session', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (!boot.ok) throw new Error(String(boot.status));
      const { data } = (await boot.json()) as { data: { csrfToken: string } };
      const res = await fetch(everywhere ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': data.csrfToken },
        body: '{}',
      });
      if (!res.ok && res.status !== 401) throw new Error(String(res.status));
      router.replace('/');
      router.refresh();
    } catch {
      setError('Signing out failed. Please try again.');
      setBusy(null);
    }
  }

  return (
    <div className="form">
      <Button variant="primary" busy={busy === 'one'} disabled={busy !== null} onClick={() => signOut(false)}>
        Sign out
      </Button>
      <Button busy={busy === 'all'} disabled={busy !== null} onClick={() => signOut(true)}>
        Sign out everywhere
      </Button>
      {error ? (
        <Alert tone="error" live>
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
