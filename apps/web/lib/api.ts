import 'server-only';

/** Channel read model returned by GET /api/v1/channels/:username (apps/api). */
export interface ChannelView {
  id: string;
  username: string;
  requestedAlias: string | null;
  type: 'channel' | 'group' | string;
  title: string;
  description: string | null;
  members: { value: string; observedAt: string } | null;
  growth: Record<'1d' | '7d', { available: true; absolute: string; percentage: number | null; previousAt: string; methodologyVersion: string } | { available: false; reason: string; methodologyVersion: string }>;
  quality: {
    verdict: string;
    members: { state: string; ageSeconds: number | null };
    metadata: { state: string; ageSeconds: number | null };
    lastCollectionErrorClass: string | null;
  };
  disclaimer: string;
}

export type ChannelResult = { kind: 'ok'; view: ChannelView } | { kind: 'not_found' };

/** Server-side API base (never exposed to the browser). */
function apiBase(): string {
  const raw = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('API_INTERNAL_URL must be http(s)');
  return url.origin;
}

/** Fetches a channel from the API with a bounded timeout. Throws on unexpected failures. */
export async function fetchChannel(username: string): Promise<ChannelResult> {
  const res = await fetch(`${apiBase()}/api/v1/channels/${encodeURIComponent(username)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'application/json' },
  });
  if (res.status === 404 || res.status === 400) return { kind: 'not_found' };
  if (!res.ok) throw new Error(`Channel API responded ${res.status}`);
  const body = (await res.json()) as { data: ChannelView };
  return { kind: 'ok', view: body.data };
}
