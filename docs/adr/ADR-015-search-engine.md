# ADR-015 — Search Engine: PostgreSQL Trigram First, Behind an Adapter

Status: Accepted (PHASE-12, 2026-09-29).

## Context

FR-SRCH-01/02 require search by name, username and keyword, with autocomplete, filters and cursor pagination. SYSTEM-ARCHITECTURE C11 leaves the engine to PHASE-12, behind an adapter. Telegram titles are multilingual (Latin, Cyrillic and others). Usernames contain `_`, a LIKE wildcard. Catalog size and latency targets are not yet set (OD-005). ADR-011 already starts analytics on PostgreSQL and adds new infrastructure only when measurements justify it.

## Decision

- **Contract:** `SearchIndex` in `@tga/types`:
  - `upsertChannel`, `removeChannel`, `searchChannels`, `suggestChannels`;
  - a shared `normalizeSearchQuery`/`normalizeSearchText` (NFKC, lowercase, control characters removed, `@`/`t.me/` prefixes stripped, 2–64 characters).

  Callers depend only on this interface.
- **First engine:** PostgreSQL `pg_trgm` (`PostgresSearchIndex` in `@tga/database`, the only package with database access):
  - `channel_search_documents` holds normalized text: current username, up to 20 previous usernames, title (≤ 512), description (≤ 1,024).
  - A GIN trigram index serves substring `LIKE` (wildcards escaped with `!`, never a backslash) and word similarity (`<%`).
  - Candidates are selected in a `MATERIALIZED` CTE so the index plan is kept. Inside the full ranked query, the planner otherwise chose a sequential scan (measured 245 ms vs 2 ms).
  - The extension is created in the migration; it is a trusted extension, so no superuser is needed.
- **Source of truth at query time:** visibility, type and member counts are always read from `channels`:
  - not hidden, `status = 'active'`, public username;
  - a stale or leftover document can never expose a hidden or inactive entity;
  - a member count whose latest observation is flagged anomalous is returned as `null` (unavailable), consistent with the entity page.
- **Relevance v1:** integer tiers from cheap string comparisons:
  - exact username 100;
  - username prefix 90;
  - exact previous username 85;
  - title prefix 80;
  - title word prefix 75;
  - username or previous username contains 70;
  - title contains 65;
  - description or other text contains 55.

  Ties break on member count, then channel id (autocomplete and search alike). The first draft scored every candidate with five `word_similarity` calls and measured 290 ms p50 for autocomplete on 50k channels, so it was rejected.
- **Typo tolerance is a fallback:** word similarity (`<%`, threshold 0.6) is used only when no visible document contains the query literally, and only for queries of 4+ characters.
  - Fuzzy matches score below 50.
  - Common queries never pay for similarity rechecks. Those can approach the whole table when trigrams are widely shared: `chat` took 850 ms with fuzzy matching always on.
  - The decision depends only on (query, data), so cursors stay consistent.
- **Pagination:** keyset cursors bound to the sort:
  - relevance cursors hold `(tier, member count, id)`;
  - member-count cursors hold `(member_count, id)` and use the index on `channels (member_count DESC, id)`.

  A cursor from another sort is rejected. The page size is capped at 100 and suggestions at 10.
- **Browse and member sort** list only channels whose member count has been collected. Text search also returns channels still pending.
- **Indexing:** `workers/search` consumes `search.index`:
  - discovery queues it on first sight; a metadata refresh queues it once per metadata version (idempotency key `metadata:<channel>:<observedAt>`);
  - `channels.updated_at` is the document version, and an older version never overwrites a newer one;
  - hidden, inactive or username-less channels are removed.
- **Exposure:** the public endpoints are behind feature flag `search.public` (off by default). While it is off they are indistinguishable from missing routes (404).

## Alternatives considered

- **Meilisearch, Typesense or OpenSearch:** better typo tolerance and faceting, but a new stateful service to run, secure (THREAT-MODEL T17), back up and keep in sync. Not justified before measurements. Moving to one later means only a new `SearchIndex` adapter plus a backfill from `search.index`.
- **Full-text search (`tsvector`):** needs per-language dictionaries and does no prefix or substring matching of usernames. Trigram search is language-agnostic.
- **Querying `channels` directly without a document table:** no place for aliases and no engine-swap seam, and it would put trigram indexes on a hot, frequently updated table.

## Consequences

- No new infrastructure. Search is transactional with the catalog, and hidden entities are excluded by construction.
- Indexing is eventually consistent: title changes appear after the `search.index` job runs.
- Relevance is computed over the whole candidate set. Two-character queries cannot use trigrams and scan (≈20–60 ms p50 at 50k channels). Measured numbers are in `docs/phases/PHASE-12-ACCEPTANCE.md`. If NFR-PERF-01 (OD-005) is not met at production scale, the next steps are, in order: a 3-character minimum for autocomplete, candidate caps, then a dedicated engine behind the same interface.
- No typo tolerance beyond trigram similarity. Categories and language filters wait for their data (no category assignment yet).
