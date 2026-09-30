/** Parsing of page query strings. Anything unexpected is dropped, never forwarded blindly. */

export type SearchParams = Record<string, string | string[] | undefined>;

/** Single-valued parameter; repeated or missing → undefined. */
export function one(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' ? v : undefined;
}

const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const COUNT = /^\d{1,19}$/;

export interface ListQuery {
  q?: string;
  type?: 'channel' | 'group';
  minMembers?: string;
  maxMembers?: string;
  sort?: 'relevance' | 'members';
  cursor?: string;
}

/** Validates the search/browse form input. Invalid optional fields are dropped. */
export function parseListQuery(params: SearchParams): ListQuery {
  const out: ListQuery = {};
  const q = one(params, 'q')?.trim();
  if (q) out.q = q.slice(0, 256);
  const type = one(params, 'type');
  if (type === 'channel' || type === 'group') out.type = type;
  const min = one(params, 'minMembers');
  if (min && COUNT.test(min)) out.minMembers = min;
  const max = one(params, 'maxMembers');
  if (max && COUNT.test(max)) out.maxMembers = max;
  const sort = one(params, 'sort');
  if (sort === 'relevance' || sort === 'members') out.sort = sort;
  const cursor = one(params, 'cursor');
  if (cursor && CURSOR.test(cursor)) out.cursor = cursor;
  return out;
}

/** Query string for a list request; `cursor` replaced (or removed with null). */
export function listQueryString(query: ListQuery, cursor?: string | null): string {
  const qs = new URLSearchParams();
  for (const key of ['q', 'type', 'minMembers', 'maxMembers', 'sort'] as const) {
    const v = query[key];
    if (v) qs.set(key, v);
  }
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const CHART_WINDOWS = [7, 30, 90, 365] as const;
export type ChartWindow = (typeof CHART_WINDOWS)[number];

export function parseWindow(params: SearchParams, fallback: ChartWindow = 30): ChartWindow {
  const n = Number(one(params, 'days'));
  return (CHART_WINDOWS as readonly number[]).includes(n) ? (n as ChartWindow) : fallback;
}
