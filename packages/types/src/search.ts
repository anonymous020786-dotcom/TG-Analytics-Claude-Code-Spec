/**
 * Search contract (PHASE-12, ADR-015). The engine sits behind this interface; the first
 * implementation is PostgreSQL trigram search (`PostgresSearchIndex` in @tga/database).
 * Text fields are matching input only: visibility, type and member counts are read from the
 * source of truth at query time, so a stale document never exposes a hidden entity.
 */

export const CHANNEL_TYPES = ['channel', 'group'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const SEARCH_SORTS = ['relevance', 'members'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Query length bounds after normalization (autocomplete starts at 2 characters). */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 64;
export const MAX_SUGGESTIONS = 10;
export const DEFAULT_SUGGESTIONS = 8;

export interface ChannelSearchDocumentInput {
  channelId: string;
  username: string;
  aliases: readonly string[];
  title: string;
  description: string | null;
  /** Version of the source state; an older version never overwrites a newer document. */
  sourceVersion: Date;
}

export interface ChannelSearchFilters {
  type?: ChannelType;
  minMembers?: bigint;
  maxMembers?: bigint;
}

export interface ChannelSearchQuery {
  /** Normalized query (see `normalizeSearchQuery`); omit to browse. `relevance` requires it. */
  q?: string;
  filters?: ChannelSearchFilters;
  sort: SearchSort;
  cursor?: string;
  limit?: number;
}

export interface ChannelSearchHit {
  channelId: string;
  username: string;
  title: string;
  type: ChannelType;
  /** Current member count; null when not yet collected or the latest observation is flagged anomalous. */
  members: { value: bigint; observedAt: Date } | null;
}

export interface SearchPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type IndexOutcome = 'indexed' | 'stale';

export interface SearchIndex {
  upsertChannel(doc: ChannelSearchDocumentInput): Promise<IndexOutcome>;
  removeChannel(channelId: string): Promise<void>;
  searchChannels(query: ChannelSearchQuery): Promise<SearchPage<ChannelSearchHit>>;
  suggestChannels(q: string, limit?: number): Promise<ChannelSearchHit[]>;
}

/**
 * Normalizes user search text: NFKC, lowercase, control characters removed, whitespace
 * collapsed, a leading "@" or t.me/ link prefix stripped. Returns null when the result is
 * outside [MIN_QUERY_LENGTH, MAX_QUERY_LENGTH].
 */
export function normalizeSearchQuery(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_QUERY_LENGTH * 4) return null;
  const q = normalizeSearchText(raw)
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//, '')
    .replace(/^@/, '')
    .trim();
  return q.length >= MIN_QUERY_LENGTH && q.length <= MAX_QUERY_LENGTH ? q : null;
}

/** Shared normalization for indexed text and queries, so both sides match. */
export function normalizeSearchText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
