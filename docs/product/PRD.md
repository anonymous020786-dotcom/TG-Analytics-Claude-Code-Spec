# Product Requirements Document

Status: PHASE-00 draft. Owner decisions are logged in `docs/product/OPEN-DECISIONS.md` (D-xxx = decided, OD-xxx = open).
Companion documents: `REQUIREMENTS.md` (feature inventory, NFRs, acceptance criteria), `DATA-POLICY.md`.

## 1. Problem

Telegram public-channel and public-group data is distributed and difficult to analyze historically, search, compare and monitor consistently.

## 2. Product

TG Analytics indexes permitted public Telegram channel and group information and turns it into searchable, historical, explainable analytics.

## 3. Product boundary

### 3.1 In scope

| Area | Boundary |
|---|---|
| Telegram entities | **Public** channels and **public** groups/supergroups, i.e. entities reachable by a public `@username` / `t.me/<username>` link (D-002). |
| Telegram access | Supported Telegram interfaces only: the Telegram Bot API and the MTProto client API (D-001), used within Telegram's terms and rate limits. |
| Data | Public entity metadata, public counts/metrics and public post/message activity as defined in `DATA-POLICY.md`. |
| Surfaces | Public web site, authenticated dashboard, admin UI, versioned public API (`/api/v1`), Telegram bot. |
| Commercial | Plans, subscriptions, entitlements, API keys/quotas (see OD-006 for tiers). |

### 3.2 Out of scope (hard boundary)

- Private channels/groups, invite-link-only entities, secret chats and direct messages.
- Joining private entities, requesting access, or using any account to see data not visible to the public.
- Browser/HTML scraping as the primary collection architecture (CLAUDE.md).
- Circumventing Telegram rate limits, bans, restrictions or access controls.
- Member lists and profiling of individual users (see `DATA-POLICY.md` §4).

## 4. Users / personas

| ID | Persona | Auth | Primary need |
|---|---|---|---|
| P1 | Anonymous discovery user | None | Find and evaluate channels/groups via search, rankings, trending and public profiles. |
| P2 | Registered analyst | Account | Track entities over time with watchlists, alerts and dashboard history. |
| P3 | Pro / business user | Paid plan | Higher limits, exports, deeper history, organization use. |
| P4 | API user | API key | Programmatic read access to public analytics under scopes and quotas. |
| P5 | Moderator | Role | Review entities, handle reports/removal requests, correct data issues. |
| P6 | Administrator | Role | Manage users, plans, jobs/workers, payments, system settings and audit. |
| P7 | Bot user | Telegram account | Query stats and receive alerts inside Telegram. |

## 5. Core capabilities

Discovery, search, entity profiles, historical statistics, post analytics, growth, trending, rankings, watchlists, alerts, bot, API, billing, admin, SEO and observability. The numbered inventory is in `REQUIREMENTS.md` §2.

## 6. MVP boundary

The spec defines launch as PHASE-36 (Production Launch), whose gates cover every capability delivered in PHASE-01 through PHASE-35. **Default MVP (derived from the phase plan): Release 1 = all capabilities in `REQUIREMENTS.md` §2 marked `R1`.**

The owner may narrow the MVP (OD-002). Until OD-002 is resolved, every §2 feature is `R1`. Anything not listed in `REQUIREMENTS.md` §2 is **not** in the MVP.

## 7. Non-goals

- Private-channel/group surveillance or access-control bypassing.
- Unauthorized data acquisition, including scraping in place of supported interfaces.
- Fabricated, estimated-as-real or backfilled statistics; unavailable metrics stay unavailable (`docs/analytics/METRICS.md`).
- Profiling, tracking or ranking individual Telegram users.
- Representing trending/rankings as official Telegram data (`docs/analytics/TRENDING.md`).
- Mass thin programmatic SEO pages (`docs/web/SEO.md`).
- Microservices/Kubernetes without measured need (ADR-001).
- Posting, messaging or engaging on behalf of users inside Telegram (other than bot replies/alerts to users who started the bot).

## 8. User journeys

Each journey step references requirement IDs from `REQUIREMENTS.md`.

### J1 — Anonymous discovery (P1)

1. Lands on `/`, a category page or a ranking from search engines (FR-SEO-01).
2. Searches by name/username/keyword with filters (FR-SRCH-01, FR-SRCH-02).
3. Opens `/channel/[username]`: sees identity, primary metrics with freshness, growth, post analytics and recent posts (FR-PROF-01, FR-PROF-02).
4. Browses `/rankings`, `/trending` with methodology shown (FR-RANK-01, FR-TRND-01).
5. Submits an unknown public `@username`/link for discovery; receives a pending/rejected/indexed status (FR-DISC-01..03).
6. Is prompted to register to track the entity (FR-AUTH-01).

### J2 — Registered analyst (P2)

1. Registers, verifies email and logs in (FR-AUTH-01..03).
2. Adds entities to watchlist; duplicates are rejected idempotently (FR-WL-01, FR-WL-02).
3. Creates an alert rule (e.g. growth threshold) (FR-ALRT-01).
4. Receives a single deduplicated notification when the rule fires (FR-ALRT-02, FR-ALRT-03).
5. Reviews history on `/dashboard` (FR-DASH-01).

### J3 — Pro/business upgrade (P3)

1. Views `/pricing`, starts checkout (FR-BILL-01).
2. Access is granted only after a verified provider webhook, not the browser redirect (FR-BILL-02).
3. Higher limits apply immediately via entitlements (FR-ENT-01); exports are generated asynchronously (FR-EXP-01).
4. Cancels/downgrades; entitlements change at the documented boundary (FR-BILL-03).

### J4 — API user (P4)

1. Creates an API key in `/dashboard/api`; the secret is shown once (FR-KEY-01).
2. Calls `/api/v1/...` with the key; receives paginated, stable-error responses with request IDs (FR-API-01..03).
3. Exceeds quota/rate limit and receives a documented limit error (FR-KEY-03).
4. Revokes/rotates the key; revoked keys fail immediately (FR-KEY-02).

### J5 — Bot user (P7)

1. Starts the bot, looks up an entity and receives stats (FR-BOT-01).
2. Links the bot to their account and receives alert notifications (FR-BOT-02).

### J6 — Moderation (P5)

1. Reviews a flagged entity or a removal/opt-out request (FR-MOD-01).
2. Hides/excludes the entity per `DATA-POLICY.md`; the action is audited (FR-MOD-01, FR-ADM-02).

### J7 — Administration (P6)

1. Inspects jobs/workers, dead-letter queue and re-drives safely (FR-ADM-01).
2. Manages users, plans and payments with confirmations; every privileged action is audited (FR-ADM-02).

### J8 — System collection pipeline (no human actor; `docs/architecture/DATA-FLOW.md`)

1. A discovery or scheduler job calls Telegram only through the adapter (Bot API or MTProto backend), with timeouts, bounded retries and rate-limit backoff (FR-TG-01..04).
2. Collectors run as idempotent queue jobs; failures back off, then go to the dead-letter queue (FR-ING-01..03).
3. Observations are validated and appended with freshness/collection status; failed collection never deletes history (FR-DQ-01, FR-DQ-02).
4. Analytics are calculated from defined metrics; missing data stays unavailable (FR-ANL-01, FR-ANL-02).
5. Health, logs, metrics and errors are observable to operators (FR-OBS-01).

## 9. Principles

Visible freshness; explainable metrics; fast public pages; mobile-first UX; server-side security; modular measurable architecture.
