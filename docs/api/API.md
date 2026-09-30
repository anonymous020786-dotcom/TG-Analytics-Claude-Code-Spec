# API

Base: /api/v1

Public:
GET /channels
GET /channels/:username
GET /channels/:id/stats
GET /channels/:id/growth
GET /channels/:id/posts
GET /rankings
GET /trending

Authenticated:
GET/POST/DELETE /watchlist
GET/POST/PATCH/DELETE /alerts

Requirements: OpenAPI, validation, pagination, authorization, rate limits, stable errors, request IDs and compatibility.

## Search and lists (PHASE-12, implemented)

Behind feature flag `search.public` (off: both routes return 404). Engine and relevance: ADR-015. No Telegram calls.

### `GET /api/v1/channels`

| Parameter | Values | Default |
|---|---|---|
| `q` | 2–64 characters after normalization (NFKC, lowercase, `@`/`t.me/` stripped) | none (browse) |
| `sort` | `relevance` (requires `q`) or `members` | `relevance` with `q`, else `members` |
| `type` | `channel` or `group` | any |
| `minMembers`, `maxMembers` | non-negative integers, `min ≤ max` | none |
| `limit` | 1–100 | 20 |
| `cursor` | opaque `page.nextCursor` from the previous response, same sort | first page |

Response `200`: `{ data: [{ id, username, title, type, members: { value, observedAt } | null }], page: { nextCursor, limit }, meta: { requestId, generatedAt } }`. `members` is `null` when not yet collected or when the latest observation is flagged anomalous. The `members` sort lists only channels with a collected count. Hidden or inactive entities never appear. `Cache-Control: public, max-age=30`.

Errors `400`: `invalid_query` (bad or repeated parameter) and `invalid_cursor` (malformed, or from another sort). Unknown parameters are ignored.

### `GET /api/v1/search/suggest`

Autocomplete: `q` (2–64 characters), `limit` 1–10 (default 8). Best match first, then larger channels. Response `{ data: [...same item shape], meta }`. It isn't under `/channels/` because `suggest` is a valid Telegram username.

## Statistics, rankings and methodology (PHASE-13, implemented)

### `GET /api/v1/channels/:id/stats`

Daily subscriber series for charts. `id` is the channel UUID; `days` is one of `7`, `30` (default), `90` or `365`. Behind flag `slice.channel-page`, with the same visibility rules as the channel page (hidden, inactive or unknown → 404).

Response `data`: `{ channelId, metric: 'members', days, from, to, points: [{ date, value, observedAt }], excludedAnomalies, methodology }`. Each point is the last valid (non-anomalous) observation of a UTC day. Days without an observation are omitted: never filled, interpolated or zero. Errors: `400 invalid_query`. `Cache-Control: public, max-age=300`.

### `GET /api/v1/rankings`, `GET /api/v1/rankings/:key`, `GET /api/v1/trending`

Behind flag `rankings.public`, which is **off until OD-015 is approved** (first public display). While off, all three return 404.

- `GET /rankings` lists every ranking: `key`, `label`, `metric`, `window`, `methodologyVersion`, `eligibility`, `tieBreak`, `disclaimer`, and `latestRun` (`asOf`, `computedAt`, `eligibleCount`, `entryCount`, or `null` before the first run).
- `GET /rankings/:key` (`top-subscribers`, `fastest-growing-7d`, `trending`) returns the latest immutable run: `data: { ranking, entries: [{ position, score, channel: { id, username, title, type, members } }] }` with `page: { nextCursor, limit }` (`limit` 1–100, default 20). Entities hidden or deactivated after the run are skipped, so a position can be missing. Before the first run, `entries` is empty (200).
- `GET /trending` is the same as `GET /rankings/trending`.

Errors: `400 invalid_query` / `invalid_cursor`; unknown key → 404. `Cache-Control: public, max-age=300`.

### `GET /api/v1/methodology`

Metric definitions from the registry (FR-ANL-01): source, observation time, calculation, window, missing-data behaviour, freshness and methodology version. Documentation only; no flag. `Cache-Control: public, max-age=3600`.
