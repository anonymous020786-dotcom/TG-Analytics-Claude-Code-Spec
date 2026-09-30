import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

/** `disabled`: sign-in is off (flag auth.login or not configured). */
export type MeResult = { kind: 'disabled' } | { kind: 'anonymous' } | { kind: 'user'; user: SessionUser; roles: string[] };

const SESSION_COOKIES = ['__Host-tga_session', 'tga_session'] as const;

function apiBase(): string {
  const url = new URL(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('API_INTERNAL_URL must be http(s)');
  return url.origin;
}

/**
 * Current user for server rendering (one API call per request). Only the session cookie is
 * forwarded; the API decides. Any failure means "anonymous" for display purposes; access
 * control is always enforced by the API, never by the page.
 */
export const currentUser = cache(async (): Promise<MeResult> => {
  const jar = await cookies();
  const pairs = SESSION_COOKIES.flatMap((name) => {
    const v = jar.get(name)?.value;
    return v && /^[A-Za-z0-9_-]{43}$/.test(v) ? [`${name}=${v}`] : [];
  });
  try {
    const res = await fetch(`${apiBase()}/api/v1/auth/me`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
      headers: { accept: 'application/json', ...(pairs.length ? { cookie: pairs.join('; ') } : {}) },
    });
    if (res.status === 404) return { kind: 'disabled' };
    if (!res.ok) return { kind: 'anonymous' };
    const body = (await res.json()) as { data: { authenticated: boolean; user: SessionUser | null; roles?: string[] } };
    return body.data.authenticated && body.data.user ? { kind: 'user', user: body.data.user, roles: body.data.roles ?? [] } : { kind: 'anonymous' };
  } catch {
    return { kind: 'anonymous' };
  }
});
