import 'server-only';
import { type ListQuery, listQueryString } from './params';

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

export interface ChannelListItem {
  id: string;
  username: string;
  title: string;
  type: string;
  members: { value: string; observedAt: string } | null;
}

export interface StatsView {
  channelId: string;
  days: number;
  from: string;
  to: string;
  points: { date: string; value: string; observedAt: string }[];
  excludedAnomalies: number;
  methodology: string;
}

export interface RankingSummary {
  key: string;
  label: string;
  metric: string;
  window: string | null;
  methodologyVersion: string;
  eligibility: { minBase: string; requireFresh: boolean };
  tieBreak: string;
  disclaimer: string | null;
  latestRun: { asOf: string; computedAt: string; eligibleCount: number; entryCount: number } | null;
}

export interface RankingEntry {
  position: number;
  score: number;
  channel: ChannelListItem;
}

export interface MetricDefinition {
  key: string;
  label: string;
  kind: string;
  source: string;
  observationTime: string;
  calculation: string;
  window: string | null;
  missingData: string;
  freshness: string;
  unit: string;
  methodologyVersion: string;
}

/**
 * Outcome of an API read. `not_found` covers unknown entities AND disabled features (the API
 * answers 404 for both); `invalid` carries the API's validation message for display.
 */
export type ApiResult<T> = { kind: 'ok'; data: T } | { kind: 'not_found' } | { kind: 'invalid'; message: string };

/** Server-side API base (never exposed to the browser). */
function apiBase(): string {
  const raw = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('API_INTERNAL_URL must be http(s)');
  return url.origin;
}

/** GET with a bounded timeout. Throws on unexpected statuses (rendered by error boundaries). */
async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const res = await fetch(`${apiBase()}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
    headers: { accept: 'application/json' },
  });
  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { kind: 'invalid', message: body?.error?.message ?? 'Invalid request' };
  }
  if (!res.ok) throw new Error(`API responded ${res.status} for ${path.split('?')[0]}`);
  return { kind: 'ok', data: (await res.json()) as T };
}

export type ChannelResult = { kind: 'ok'; view: ChannelView } | { kind: 'not_found' };

export async function fetchChannel(username: string): Promise<ChannelResult> {
  const r = await apiGet<{ data: ChannelView }>(`/api/v1/channels/${encodeURIComponent(username)}`);
  return r.kind === 'ok' ? { kind: 'ok', view: r.data.data } : { kind: 'not_found' };
}

export async function fetchChannelList(query: ListQuery, limit = 20): Promise<ApiResult<{ items: ChannelListItem[]; nextCursor: string | null }>> {
  const qs = listQueryString(query, query.cursor);
  const r = await apiGet<{ data: ChannelListItem[]; page: { nextCursor: string | null } }>(`/api/v1/channels${qs}${qs ? '&' : '?'}limit=${limit}`);
  return r.kind === 'ok' ? { kind: 'ok', data: { items: r.data.data, nextCursor: r.data.page.nextCursor } } : r;
}

export async function fetchStats(channelId: string, days: number): Promise<ApiResult<StatsView>> {
  const r = await apiGet<{ data: StatsView }>(`/api/v1/channels/${encodeURIComponent(channelId)}/stats?days=${days}`);
  return r.kind === 'ok' ? { kind: 'ok', data: r.data.data } : r;
}

export async function fetchRankings(): Promise<ApiResult<RankingSummary[]>> {
  const r = await apiGet<{ data: RankingSummary[] }>('/api/v1/rankings');
  return r.kind === 'ok' ? { kind: 'ok', data: r.data.data } : r;
}

export async function fetchRanking(key: string, cursor?: string, limit = 50): Promise<ApiResult<{ ranking: RankingSummary; entries: RankingEntry[]; nextCursor: string | null }>> {
  const qs = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
  const r = await apiGet<{ data: { ranking: RankingSummary; entries: RankingEntry[] }; page: { nextCursor: string | null } }>(`/api/v1/rankings/${encodeURIComponent(key)}?${qs}`);
  return r.kind === 'ok' ? { kind: 'ok', data: { ...r.data.data, nextCursor: r.data.page.nextCursor } } : r;
}

export async function fetchMethodology(): Promise<ApiResult<{ metrics: MetricDefinition[] }>> {
  const r = await apiGet<{ data: { metrics: MetricDefinition[] } }>('/api/v1/methodology');
  return r.kind === 'ok' ? { kind: 'ok', data: r.data.data } : r;
}

const NAV_TTL_MS = 15_000;
let navMemo: { value: boolean; at: number } | undefined;

/**
 * Whether rankings are publicly enabled (flag rankings.public), for navigation only. Memoized
 * in-process with a hard 15 s expiry (not Next's stale-while-revalidate data cache, which can
 * serve a stale answer indefinitely between visits). Any failure hides the links (fail closed).
 */
export async function rankingsAvailable(): Promise<boolean> {
  const now = Date.now();
  if (navMemo && now - navMemo.at < NAV_TTL_MS) return navMemo.value;
  let value: boolean;
  try {
    const res = await fetch(`${apiBase()}/api/v1/rankings`, { cache: 'no-store', signal: AbortSignal.timeout(2_000), headers: { accept: 'application/json' } });
    value = res.ok;
  } catch {
    value = false;
  }
  navMemo = { value, at: now };
  return value;
}
