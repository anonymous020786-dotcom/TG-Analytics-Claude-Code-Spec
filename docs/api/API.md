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
