import { DEFAULT_PAGE_SIZE, type FeatureFlagRepository, InvalidCursorError, InvalidSearchQueryError, MAX_PAGE_SIZE } from '@tga/database';
import {
  CHANNEL_TYPES,
  type ChannelSearchFilters,
  type ChannelSearchHit,
  type ChannelType,
  DEFAULT_SUGGESTIONS,
  MAX_SUGGESTIONS,
  normalizeSearchQuery,
  SEARCH_SORTS,
  type SearchIndex,
  type SearchSort,
} from '@tga/types';

/** Feature flag guarding public search (PHASE-12). Unknown flags are off (fail closed). */
export const SEARCH_FLAG = 'search.public';

export interface SearchReaderDeps {
  index: SearchIndex;
  flags: FeatureFlagRepository;
  /** How long a flag lookup is cached in-process. */
  flagCacheMs?: number;
}

export interface ChannelListItem {
  id: string;
  username: string;
  title: string;
  type: ChannelType;
  members: { value: string; observedAt: string } | null;
}

export type Params = Record<string, unknown>;
export type SearchResult<T> = { kind: 'ok'; value: T } | { kind: 'disabled' } | { kind: 'invalid'; code: 'invalid_query' | 'invalid_cursor'; message: string };

const MAX_CURSOR = 512;
const COUNT = /^\d{1,19}$/;

class BadParam extends Error {}

const toItem = (h: ChannelSearchHit): ChannelListItem => ({
  id: h.channelId,
  username: h.username,
  title: h.title,
  type: h.type,
  members: h.members ? { value: h.members.value.toString(), observedAt: h.members.observedAt.toISOString() } : null,
});

/** Single-valued optional string parameter; repeated parameters are rejected. */
function single(params: Params, key: string): string | undefined {
  const v = params[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new BadParam(`${key} must be given once`);
  return v;
}

function count(params: Params, key: string): bigint | undefined {
  const v = single(params, key);
  if (v === undefined) return undefined;
  if (!COUNT.test(v)) throw new BadParam(`${key} must be a non-negative integer`);
  return BigInt(v);
}

function intIn(params: Params, key: string, min: number, max: number): number | undefined {
  const v = single(params, key);
  if (v === undefined) return undefined;
  const n = /^\d{1,4}$/.test(v) ? Number(v) : Number.NaN;
  if (!(n >= min && n <= max)) throw new BadParam(`${key} must be an integer between ${min} and ${max}`);
  return n;
}

/**
 * Public search, filters and autocomplete (FR-SRCH-01/02). Validates every query parameter
 * after the (cached) flag check, hides everything while the flag is off, never calls Telegram.
 */
export class SearchReader {
  private flagCache: { value: boolean; at: number } | undefined;

  constructor(private readonly deps: SearchReaderDeps) {}

  async list(params: Params): Promise<SearchResult<{ items: ChannelListItem[]; nextCursor: string | null; limit: number }>> {
    if (!(await this.enabled())) return { kind: 'disabled' };
    try {
      const rawQ = single(params, 'q');
      const q = rawQ === undefined || rawQ.trim() === '' ? undefined : normalizeSearchQuery(rawQ);
      if (q === null) throw new BadParam('q must be 2-64 characters');
      const sortParam = single(params, 'sort');
      if (sortParam !== undefined && !(SEARCH_SORTS as readonly string[]).includes(sortParam)) throw new BadParam(`sort must be one of ${SEARCH_SORTS.join(', ')}`);
      const sort = (sortParam ?? (q ? 'relevance' : 'members')) as SearchSort;
      if (sort === 'relevance' && !q) throw new BadParam('sort=relevance requires q');
      const type = single(params, 'type');
      if (type !== undefined && !(CHANNEL_TYPES as readonly string[]).includes(type)) throw new BadParam(`type must be one of ${CHANNEL_TYPES.join(', ')}`);
      const minMembers = count(params, 'minMembers');
      const maxMembers = count(params, 'maxMembers');
      if (minMembers !== undefined && maxMembers !== undefined && minMembers > maxMembers) throw new BadParam('minMembers must not exceed maxMembers');
      const cursor = single(params, 'cursor');
      if (cursor !== undefined && (cursor.length === 0 || cursor.length > MAX_CURSOR)) throw new InvalidCursorError();
      const limit = intIn(params, 'limit', 1, MAX_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE;

      const filters: ChannelSearchFilters = {
        ...(type ? { type: type as ChannelType } : {}),
        ...(minMembers !== undefined ? { minMembers } : {}),
        ...(maxMembers !== undefined ? { maxMembers } : {}),
      };
      const page = await this.deps.index.searchChannels({ sort, filters, limit, ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) });
      return { kind: 'ok', value: { items: page.items.map(toItem), nextCursor: page.nextCursor, limit } };
    } catch (error) {
      return invalid(error);
    }
  }

  async suggest(params: Params): Promise<SearchResult<ChannelListItem[]>> {
    if (!(await this.enabled())) return { kind: 'disabled' };
    try {
      const q = normalizeSearchQuery(single(params, 'q') ?? '');
      if (q === null) throw new BadParam('q must be 2-64 characters');
      const limit = intIn(params, 'limit', 1, MAX_SUGGESTIONS) ?? DEFAULT_SUGGESTIONS;
      return { kind: 'ok', value: (await this.deps.index.suggestChannels(q, limit)).map(toItem) };
    } catch (error) {
      return invalid(error);
    }
  }

  private async enabled(): Promise<boolean> {
    const ttl = this.deps.flagCacheMs ?? 15_000;
    const nowMs = Date.now();
    if (this.flagCache && nowMs - this.flagCache.at < ttl) return this.flagCache.value;
    const value = await this.deps.flags.isEnabled(SEARCH_FLAG);
    this.flagCache = { value, at: nowMs };
    return value;
  }
}

function invalid(error: unknown): SearchResult<never> {
  if (error instanceof InvalidCursorError) return { kind: 'invalid', code: 'invalid_cursor', message: 'Invalid pagination cursor' };
  if (error instanceof BadParam || error instanceof InvalidSearchQueryError) return { kind: 'invalid', code: 'invalid_query', message: error.message };
  throw error;
}
