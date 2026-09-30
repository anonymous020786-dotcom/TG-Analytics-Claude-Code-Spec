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

Behind flag `rankings.public` (parameters approved as D-019; the flag is an operational switch). While off, all three return 404.

- `GET /rankings` lists every ranking: `key`, `label`, `metric`, `window`, `methodologyVersion`, `eligibility`, `tieBreak`, `disclaimer`, and `latestRun` (`asOf`, `computedAt`, `eligibleCount`, `entryCount`, or `null` before the first run).
- `GET /rankings/:key` (`top-subscribers`, `fastest-growing-7d`, `trending`) returns the latest immutable run: `data: { ranking, entries: [{ position, score, channel: { id, username, title, type, members } }] }` with `page: { nextCursor, limit }` (`limit` 1–100, default 20). Entities hidden or deactivated after the run are skipped, so a position can be missing. Before the first run, `entries` is empty (200).
- `GET /trending` is the same as `GET /rankings/trending`.

Errors: `400 invalid_query` / `invalid_cursor`; unknown key → 404. `Cache-Control: public, max-age=300`.

### `GET /api/v1/methodology`

Metric definitions from the registry (FR-ANL-01): source, observation time, calculation, window, missing-data behaviour, freshness and methodology version. Documentation only; no flag. `Cache-Control: public, max-age=3600`.

## SEO support (PHASE-14, implemented)

- `GET /api/v1/channels/:username` also returns `seo: { indexable }`: the master switch `seo.indexing` AND the indexation rule (ADR-016). Additive field; existing clients are unaffected.
- `GET /api/v1/seo/settings` returns `{ indexing, policy: { minMembers, minHistoryDays, maxAgeHours } }`. `Cache-Control: public, max-age=60`.
- `GET /api/v1/seo/channels?limit=1..5000&cursor=` returns `data: [{ username, lastModified }]` and `page: { nextCursor }`: channels indexable right now, keyset-paged, for the sitemap. It is empty while `seo.indexing` is off. Errors: `400 invalid_query`. `Cache-Control: public, max-age=600`.

## Accounts and sessions (PHASE-16, implemented)

Sign in with Telegram only (D-021, ADR-017). Routes exist when the login bot and CSRF secret are configured, and answer only while flag `auth.login` is on (otherwise 404). All responses: `Cache-Control: no-store`.

State-changing requests (`POST`) must send `Content-Type: application/json`, an `Origin` equal to the public site, and `X-CSRF-Token` from `GET /session`. Otherwise they get `415 unsupported_media_type`, `403 origin_not_allowed` or `403 csrf_failed`.

| Method and path | Purpose | Response |
|---|---|---|
| `GET /api/v1/auth/session` | Browser bootstrap | `{ authenticated, user, csrfToken, loginBot: { username } }`; sets the `__Host-tga_pre` nonce cookie before sign-in |
| `GET /api/v1/auth/me` | Read-only session check (web server) | `{ authenticated, user }` |
| `POST /api/v1/auth/telegram` | Sign in with the Telegram Login Widget payload (as received) | `200 { user, created, csrfToken }` and sets `__Host-tga_session`; `401 invalid_login` (any verification failure); `403 account_disabled` |
| `POST /api/v1/auth/logout` | End this session | `200 { revoked: 1 }`, clears the cookie; `401 not_authenticated` |
| `POST /api/v1/auth/logout-all` | End every session of the user | `200 { revoked: n }`, clears the cookie |

`user` = `{ id, firstName, lastName, username }`.

## Authorization (PHASE-17, implemented)

Guarded routes answer `401 not_authenticated` without a session and `403 forbidden` without the required permission (ADR-018). Changes need `Origin` and `X-CSRF-Token` as for sign-out. Another user's object is `404`, never `403`.

| Method and path | Requires | Response |
|---|---|---|
| `GET /api/v1/auth/sessions` | signed in | Own active sessions: `[{ id, current, createdAt, lastSeenAt, userAgent }]` |
| `DELETE /api/v1/auth/sessions/:id` | signed in, own session | `{ revoked: true, current }`; another user's or unknown id → `404` |
| `GET /api/v1/admin/users/:userId/roles` | `roles.manage` | `{ userId, roles }` |
| `PUT /api/v1/admin/users/:userId/roles/:role` | `roles.manage` | `{ userId, role, granted }` (idempotent; audited `role.granted`) |
| `DELETE /api/v1/admin/users/:userId/roles/:role` | `roles.manage` | `{ userId, role, revoked }`; last admin → `409 last_role_holder` (audited `role.revoked`) |

Unknown user or malformed id → `404 not_found`; unknown role → `404 unknown_role`. `GET /api/v1/auth/me` also returns `roles` (display only).
