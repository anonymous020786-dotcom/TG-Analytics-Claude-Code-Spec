'use client';

import { Alert, Button, EmptyState, Skeleton } from '@tga/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
}

const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** Rough, privacy-friendly label from the stored (truncated) User-Agent. */
function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** The signed-in user's own sessions; each can be ended individually (object-level API). */
export function Sessions() {
  const router = useRouter();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/auth/sessions', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      setRows(((await res.json()) as { data: SessionRow[] }).data);
    } catch {
      setError('Your sessions could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(row: SessionRow) {
    setBusy(row.id);
    setError(null);
    try {
      const boot = await fetch('/api/v1/auth/session', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      const { data } = (await boot.json()) as { data: { csrfToken: string } };
      const res = await fetch(`/api/v1/auth/sessions/${encodeURIComponent(row.id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { accept: 'application/json', 'x-csrf-token': data.csrfToken } });
      if (!res.ok) throw new Error(String(res.status));
      if (row.current) {
        router.replace('/');
        router.refresh();
        return;
      }
      await load();
    } catch {
      setError('That session could not be ended. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (error && !rows) return <Alert tone="error" live>{error}</Alert>;
  if (!rows) return <Skeleton label="Loading sessions" style={{ height: 96 }} />;
  if (rows.length === 0) return <EmptyState title="No active sessions." />;
  return (
    <>
      {error ? (
        <Alert tone="error" live>
          {error}
        </Alert>
      ) : null}
      <ul className="list" aria-label="Active sessions">
        {rows.map((s) => (
          <li key={s.id}>
            <span className="name">
              {deviceLabel(s.userAgent)} {s.current ? <strong>(this browser)</strong> : null}
              <br />
              <span className="small muted">
                Signed in {dateFmt.format(new Date(s.createdAt))} · last active {dateFmt.format(new Date(s.lastSeenAt))}
              </span>
            </span>
            <Button busy={busy === s.id} disabled={busy !== null} onClick={() => revoke(s)}>
              {s.current ? 'Sign out' : 'End session'}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
