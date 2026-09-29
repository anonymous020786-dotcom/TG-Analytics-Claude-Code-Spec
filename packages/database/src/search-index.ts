import {
  type ChannelSearchDocumentInput,
  type ChannelSearchHit,
  type ChannelSearchQuery,
  type ChannelType,
  DEFAULT_SUGGESTIONS,
  type IndexOutcome,
  MAX_SUGGESTIONS,
  normalizeSearchQuery,
  normalizeSearchText,
  type SearchIndex,
  type SearchPage,
} from '@tga/types';
import type { Database } from './client';
import { Prisma } from './generated/prisma/client';
import { clampLimit, decodeCursor, encodeCursor, InvalidCursorError } from './pagination';

const MAX_TITLE = 512;
const MAX_DESCRIPTION = 1024;
const MAX_ALIASES = 1024;
const MAX_SEARCH_TEXT = 4096;
const INT8_MAX = 9_223_372_036_854_775_807n;
/** Fuzzy (typo-tolerant) matching needs enough trigrams to be selective. */
const FUZZY_MIN_LENGTH = 4;

export class InvalidSearchQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSearchQueryError';
  }
}

interface HitRow {
  id: string;
  username: string;
  title: string;
  type: string;
  member_count: bigint | null;
  member_count_observed_at: Date | null;
  anomalous: boolean;
  s: number | null;
}

/** LIKE escape with '!' (no backslash, so no string-literal escaping ambiguity). */
const escapeLike = (s: string) => s.replace(/[!%_]/g, (m) => `!${m}`);
const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max).trimEnd());

/**
 * PostgreSQL trigram implementation of `SearchIndex` (ADR-015).
 *
 * Matching uses `channel_search_documents` (GIN trigram index: substring LIKE and word
 * similarity). Visibility (not hidden, active, has a public username), type and member counts
 * are always read from `channels`, so a stale document cannot expose a hidden entity.
 * Relevance v1: integer tiers (exact username 100 … description substring 55, fuzzy-only
 * matches below 50); ties break on member count, then channel id.
 */
export class PostgresSearchIndex implements SearchIndex {
  constructor(private readonly db: Database) {}

  async upsertChannel(doc: ChannelSearchDocumentInput): Promise<IndexOutcome> {
    const username = normalizeSearchText(doc.username);
    const title = clip(normalizeSearchText(doc.title), MAX_TITLE) || username;
    const description = clip(normalizeSearchText(doc.description ?? ''), MAX_DESCRIPTION);
    const aliasList: string[] = [];
    for (const a of doc.aliases.map(normalizeSearchText)) {
      if (!a || a === username || aliasList.includes(a)) continue;
      if ([...aliasList, a].join(' ').length > MAX_ALIASES) break;
      aliasList.push(a);
    }
    const aliases = aliasList.join(' ');
    const searchText = clip([username, aliases, title, description].filter(Boolean).join(' '), MAX_SEARCH_TEXT);

    const rows = await this.db.$queryRaw<{ channel_id: string }[]>`
      INSERT INTO channel_search_documents (channel_id, username, aliases, title, description, search_text, source_version)
      VALUES (${doc.channelId}::uuid, ${username}, ${aliases}, ${title}, ${description}, ${searchText}, ${doc.sourceVersion})
      ON CONFLICT (channel_id) DO UPDATE SET
        username = EXCLUDED.username, aliases = EXCLUDED.aliases, title = EXCLUDED.title,
        description = EXCLUDED.description, search_text = EXCLUDED.search_text,
        source_version = EXCLUDED.source_version, indexed_at = CURRENT_TIMESTAMP
      WHERE channel_search_documents.source_version <= EXCLUDED.source_version
      RETURNING channel_id`;
    return rows.length === 1 ? 'indexed' : 'stale';
  }

  async removeChannel(channelId: string): Promise<void> {
    await this.db.$executeRaw`DELETE FROM channel_search_documents WHERE channel_id = ${channelId}::uuid`;
  }

  async searchChannels(query: ChannelSearchQuery): Promise<SearchPage<ChannelSearchHit>> {
    const limit = clampLimit(query.limit);
    const q = query.q === undefined ? undefined : normalizeSearchQuery(query.q);
    if (q === null) throw new InvalidSearchQueryError('query must be 2-64 characters');
    const f = query.filters ?? {};
    for (const v of [f.minMembers, f.maxMembers]) {
      if (v !== undefined && (v < 0n || v > INT8_MAX)) throw new InvalidSearchQueryError('member filter out of range');
    }

    const filters = Prisma.sql`
      c.hidden_at IS NULL AND c.status = 'active' AND c.username IS NOT NULL
      ${f.type ? Prisma.sql`AND c.type = ${f.type}` : Prisma.empty}
      ${f.minMembers !== undefined ? Prisma.sql`AND c.member_count >= ${f.minMembers}` : Prisma.empty}
      ${f.maxMembers !== undefined ? Prisma.sql`AND c.member_count <= ${f.maxMembers}` : Prisma.empty}`;

    let rows: HitRow[];
    if (query.sort === 'relevance') {
      if (q === undefined) throw new InvalidSearchQueryError('relevance sort requires a query');
      const after = query.cursor ? decodeCursor(query.cursor, { s: 'int', m: 'bigint', id: 'uuid' }) : undefined;
      if (after && BigInt(after.m) > INT8_MAX) throw new InvalidCursorError();
      const keyset = after
        ? Prisma.sql`WHERE s < ${Number(after.s)} OR (s = ${Number(after.s)} AND (m < ${BigInt(after.m)} OR (m = ${BigInt(after.m)} AND id > ${after.id}::uuid)))`
        : Prisma.empty;
      rows = await this.ranked(q, filters, keyset, limit + 1, await this.useFuzzy(q, filters));
      return this.page(rows, limit, (r) => ({ s: String(r.s), m: String(r.member_count ?? 0n), id: r.id }));
    }

    const after = query.cursor ? decodeCursor(query.cursor, { m: 'bigint', id: 'uuid' }) : undefined;
    const m = after ? BigInt(after.m) : undefined;
    if (m !== undefined && m > INT8_MAX) throw new InvalidCursorError();
    const keyset = after ? Prisma.sql`AND (c.member_count < ${m} OR (c.member_count = ${m} AND c.id > ${after.id}::uuid))` : Prisma.empty;
    const match =
      q === undefined
        ? Prisma.empty
        : Prisma.sql`AND c.id IN (SELECT d.channel_id FROM channel_search_documents d WHERE ${this.matches(q, await this.useFuzzy(q, filters))})`;
    rows = await this.db.$queryRaw<HitRow[]>`
      SELECT ${this.columns()}, NULL::int AS s
      FROM channels c
      WHERE ${filters} AND c.member_count IS NOT NULL ${match} ${keyset}
      ORDER BY c.member_count DESC, c.id ASC
      LIMIT ${limit + 1}`;
    return this.page(rows, limit, (r) => ({ m: String(r.member_count), id: r.id }));
  }

  async suggestChannels(raw: string, limit = DEFAULT_SUGGESTIONS): Promise<ChannelSearchHit[]> {
    const q = normalizeSearchQuery(raw);
    if (q === null) throw new InvalidSearchQueryError('query must be 2-64 characters');
    const n = Math.min(Math.max(Math.trunc(limit) || DEFAULT_SUGGESTIONS, 1), MAX_SUGGESTIONS);
    const filters = Prisma.sql`c.hidden_at IS NULL AND c.status = 'active' AND c.username IS NOT NULL`;
    return (await this.ranked(q, filters, Prisma.empty, n, await this.useFuzzy(q, filters))).map(toHit);
  }

  /** Candidates: substring match (GIN trigram), or word similarity when falling back to fuzzy. */
  private matches(q: string, fuzzy: boolean): Prisma.Sql {
    return fuzzy ? Prisma.sql`${q} <% d.search_text` : Prisma.sql`d.search_text LIKE ${`%${escapeLike(q)}%`} ESCAPE '!'`;
  }

  /**
   * Typo tolerance is a fallback: only when no visible document contains the query literally
   * (and the query has 4+ characters). Common queries never pay for similarity rechecks, whose
   * GIN candidate sets can approach the whole table when trigrams are shared widely. The
   * decision depends only on (query, data), so cursors stay consistent.
   */
  private async useFuzzy(q: string, filters: Prisma.Sql): Promise<boolean> {
    if (q.length < FUZZY_MIN_LENGTH) return false;
    const [row] = await this.db.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM channel_search_documents d JOIN channels c ON c.id = d.channel_id
        WHERE ${this.matches(q, false)} AND ${filters}
      ) AS found`;
    return !row?.found;
  }

  private columns(): Prisma.Sql {
    return Prisma.sql`c.id, c.username, c.title, c.type, c.member_count, c.member_count_observed_at,
      EXISTS (
        SELECT 1 FROM metric_anomalies a
        WHERE a.channel_id = c.id AND a.metric = 'members' AND a.observed_at = c.member_count_observed_at
      ) AS anomalous`;
  }

  /**
   * Relevance v1 (ADR-015), integer tiers computed with cheap string comparisons; word
   * similarity is evaluated only in the fuzzy fallback (no literal match exists). Order: tier, member count, id.
   * Display columns (and the anomaly check) are computed for the returned page only.
   */
  private ranked(q: string, filters: Prisma.Sql, keyset: Prisma.Sql, take: number, fuzzy: boolean): Promise<HitRow[]> {
    const esc = escapeLike(q);
    const prefix = `${esc}%`;
    const contains = `%${esc}%`;
    return this.db.$queryRaw<HitRow[]>`
      WITH candidates AS MATERIALIZED (
        -- Planned on its own so the GIN trigram index is used; otherwise the planner may pick a
        -- sequential scan evaluating the fuzzy operator on every row to feed the ORDER BY.
        SELECT d.channel_id FROM channel_search_documents d WHERE ${this.matches(q, fuzzy)}
      ), scored AS (
        SELECT c.id, coalesce(c.member_count, 0) AS m,
          CASE WHEN d.username = ${q} THEN 100
               WHEN d.username LIKE ${prefix} ESCAPE '!' THEN 90
               WHEN ${q} = ANY (string_to_array(d.aliases, ' ')) THEN 85
               WHEN d.title LIKE ${prefix} ESCAPE '!' THEN 80
               WHEN d.title LIKE ${`% ${prefix}`} ESCAPE '!' THEN 75
               WHEN d.username LIKE ${contains} ESCAPE '!' OR d.aliases LIKE ${contains} ESCAPE '!' THEN 70
               WHEN d.title LIKE ${contains} ESCAPE '!' THEN 65
               WHEN d.search_text LIKE ${contains} ESCAPE '!' THEN 55
               ELSE floor(50 * word_similarity(${q}, d.search_text))::int
          END AS s
        FROM candidates k
        JOIN channel_search_documents d ON d.channel_id = k.channel_id
        JOIN channels c ON c.id = d.channel_id
        WHERE ${filters}
      ), page AS (
        SELECT id, s, m FROM scored ${keyset}
        ORDER BY s DESC, m DESC, id ASC
        LIMIT ${take}
      )
      SELECT ${this.columns()}, p.s
      FROM page p JOIN channels c ON c.id = p.id
      ORDER BY p.s DESC, p.m DESC, p.id ASC`;
  }

  private page(rows: HitRow[], limit: number, cursorOf: (r: HitRow) => Record<string, string>): SearchPage<ChannelSearchHit> {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items: items.map(toHit), nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
  }
}

function toHit(r: HitRow): ChannelSearchHit {
  return {
    channelId: r.id,
    username: r.username,
    title: r.title,
    type: r.type as ChannelType,
    members: r.member_count !== null && r.member_count_observed_at && !r.anomalous ? { value: r.member_count, observedAt: r.member_count_observed_at } : null,
  };
}
