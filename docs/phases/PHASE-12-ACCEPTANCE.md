# Phase 12 Acceptance Matrix — Search

Verified on 2026-09-30. Engine decision and relevance: ADR-015. API: `docs/api/API.md` (Search and lists).

| Area | Required | Evidence |
|---|---|---|
| Search abstraction | Engine behind an interface; swappable without caller changes | `SearchIndex` (`@tga/types`); `PostgresSearchIndex` (`@tga/database`, the only DB-access package); boundary check passes (16 packages) |
| FR-SRCH-01 search | Name, username and keyword (description) search, multilingual | Integration tests: username/prefix/alias/title/description matches, Cyrillic titles; staging: `@Telegram` → `telegram` first |
| FR-SRCH-01 autocomplete | Bounded suggestions, best first | `GET /api/v1/search/suggest` (limit ≤ 10); tests; staging: `du` → `durov` |
| FR-SRCH-02 filters | Type and member-range filters, sorts | `type`, `minMembers`, `maxMembers`, `sort=relevance\|members`; integration and e2e tests |
| FR-SRCH-02 pagination | Page size capped; cursor walk returns every row exactly once | Cap 100 (tests with `limit=10000`/`101`); keyset cursors bound to the sort; walk tests for relevance ties and equal member counts (DB and HTTP) |
| Relevance | Deterministic, documented, versioned in an ADR | Tiered v1 (ADR-015); tie-break member count, then id; typo tolerance as fallback only; tests |
| Visibility | Hidden, non-active and username-less entities never appear, even with a stale document | Visibility read from `channels` at query time; tests for search, browse and suggest |
| Data quality | No invented or anomalous values | `members` is `null` when uncollected or when the latest observation is flagged anomalous (test) |
| Indexing | Idempotent worker; no older overwrites; removal of invisible entities | `workers/search` (`search.index`); version guard on `channels.updated_at` (test); metadata changes queue one reindex per version (test) |
| Input validation / injection | Every parameter validated; payloads inert | 400 `invalid_query`/`invalid_cursor` for 14 bad-input cases; SQL/LIKE metacharacters, `!` and backslash treated as data; bracket and `__proto__` parameters ignored; no DB errors, no data loss |
| Flag | Risky public surface off by default; fail closed | `search.public`; 404 for valid and invalid input while off (test; staging before enabling) |
| Migration | Schema change via migration; no drift | `20260929154738_search_index` (`pg_trgm`, GIN trigram index, member-count keyset index, CHECK constraints); `db:check` clean; applied in staging by the `migrate` job |
| Performance | Measure before claiming; NFR-PERF-01 numbers are OD-005 | 50k synthetic channels, local Docker Desktop, 200 runs each (table below) |
| Staging | Verified before acceptance | Rebuilt `migrate`, `api`, `worker-search`, `worker-metadata`; smoke 8/8; search/suggest/browse on real data; `Cache-Control`, request id and `noindex` headers present |
| Findings | Defects found and fixed during the phase | (1) `search.index` had no payload schema, so jobs dead-lettered in staging: schema registered, contract test added, dead jobs re-driven via the audited CLI. (2) First relevance draft: 290 ms p50 autocomplete, rewritten to cheap tiers. (3) The planner chose a sequential scan inside the ranked query: candidates in a `MATERIALIZED` CTE. (4) Always-on fuzzy matching cost 850 ms for `chat`: fuzzy made a no-literal-match fallback. |
| Tests | Suites pass | `pnpm run ci` green: lint, typecheck, boundaries, `db:check`, build, 400 tests, audit (no known vulnerabilities) |
| Deferred | Out of scope | `/search` page and UI (PHASE-13/15); OpenAPI (PHASE-22); API rate limits beyond the edge (PHASE-22/23; nginx per-IP limits apply); category and language filters (no data yet); NFR-PERF-01 target (OD-005) |

## Measured latency (50k channels, final implementation)

| Operation | Pessimistic corpus p50 / p95 | Realistic corpus p50 / p95 |
|---|---|---|
| Autocomplete, 2–8 character prefixes | 18.5 / 34.7 ms | 12.2 / 22.3 ms |
| Autocomplete, 2 characters (no trigram index) | 22.0 / 56.4 ms | 18.9 / 52.8 ms |
| Autocomplete, typo fallback (no literal match) | 64.9 / 89.8 ms | 44.9 / 58.1 ms |
| Relevance search, common word, 20 results | 16.7 / 21.2 ms | 12.1 / 15.5 ms |
| Relevance search, walking cursor | 12.6 / 15.2 ms | 13.3 / 19.5 ms |
| Browse by members, first page | 1.0 / 1.4 ms | 1.2 / 4.3 ms |
| Search + members sort + `minMembers` | 2.7 / 3.6 ms | 4.5 / 9.7 ms |

Pessimistic corpus: every title uses 3 of 30 words, so each common query matches ~1,700 rows. Realistic corpus: 1 common word plus 2 of ~20,000 pseudo-words per title. Measured through `PostgresSearchIndex` (no HTTP) against PostgreSQL 18 on Docker Desktop (Windows), after `VACUUM ANALYZE`. Slowest remaining queries are 2-character prefixes (≤ 160 ms max). Next steps if production targets require them are in ADR-015.
