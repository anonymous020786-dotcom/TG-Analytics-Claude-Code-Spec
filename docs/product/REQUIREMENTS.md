# Functional / Non-Functional Requirements

Status: PHASE-00 accepted baseline. Release tag `R1` = MVP per `PRD.md` §6 (D-005).
Every requirement traces to its source document and to the phase that implements it. Acceptance criteria (AC) are written to be verifiable by an automated test or a recorded manual check.

## 1. Summary

Functional: channel/group discovery; canonical identity; historical metrics; analytics; search; filters; monitoring; alerts; API; API keys; billing; admin; bot.

Non-functional: secure, responsive, accessible, SEO-ready, observable, horizontally scalable, recoverable, backward-compatible public API.

## 2. Feature inventory and acceptance criteria

### 2.1 Telegram integration and discovery

| ID | Requirement | Acceptance criteria | Source | Phase | Rel |
|---|---|---|---|---|---|
| FR-TG-01 | All Telegram access goes through adapters (`TelegramClientAdapter`, resolver, mapper, rate limiter, error classifier); controllers never call Telegram SDKs. | Static check: no Telegram SDK import outside the adapter package. | INTEGRATION.md | 06 | R1 |
| FR-TG-02 | Bot API and MTProto are both supported behind the adapter (D-001). | Adapter contract tests pass against both backend implementations using recorded fixtures. | D-001 | 06 | R1 |
| FR-TG-03 | Every external call has a timeout, bounded retries and error classification. | Test: simulated timeout → classified `transient`; retries stop at the configured maximum; no infinite retry path exists. | CLAUDE.md, QUEUE-ARCHITECTURE.md | 06, 09 | R1 |
| FR-TG-04 | Rate-limit signals are classified, persisted, backed off and rescheduled with jitter. | Test: a flood-wait/429 response → job rescheduled no earlier than the provider-given delay; concurrent jobs do not retry in lockstep. | RATE-LIMITING.md | 06 | R1 |
| FR-DISC-01 | A public URL/`@username` is normalized and validated before resolution. | Test: variants (`t.me/x`, `https://t.me/x`, `@x`, `X`) normalize identically; invalid input is rejected with a validation error and no Telegram call. | DISCOVERY.md | 07 | R1 |
| FR-DISC-02 | Only public channels/groups pass the scope check (D-002). | Test: private, invite-only or non-public results are rejected and not persisted. | DISCOVERY.md, D-002 | 07 | R1 |
| FR-DISC-03 | Stable Telegram ID is the canonical identity; username changes become aliases. | Test: same ID with a new username → one entity row + one new alias; no duplicate entity. | DISCOVERY.md | 07 | R1 |

### 2.2 Ingestion, reliability and data quality

| ID | Requirement | Acceptance criteria | Source | Phase | Rel |
|---|---|---|---|---|---|
| FR-ING-01 | Metadata, posts and metrics are collected by queue workers, not request handlers. | No page/API request triggers a live Telegram call (verified by an adapter spy in integration tests). | DATA-FLOW.md | 08 | R1 |
| FR-ING-02 | Every side-effecting job is idempotent (idempotency key + durable status). | Test: the same job delivered twice → one persisted result. | ADR-004 | 08, 09 | R1 |
| FR-ING-03 | Failed jobs use bounded exponential backoff and a dead-letter queue with safe re-drive. | Test: after max attempts the job is in DLQ with attempt history; re-drive does not duplicate side effects. | QUEUE-ARCHITECTURE.md | 09 | R1 |
| FR-DQ-01 | Each entity/metric exposes freshness and collection status. | API/UI show last-observed time and status for every metric displayed. | INTEGRATION.md, PRD principles | 10 | R1 |
| FR-DQ-02 | Historical observations are append-only and never deleted because collection failed. | Test: a failed collection leaves prior snapshots unchanged and records status `failed`. | CLAUDE.md, CLICKHOUSE.md | 05, 10 | R1 |

### 2.3 Analytics, rankings, trending

| ID | Requirement | Acceptance criteria | Source | Phase | Rel |
|---|---|---|---|---|---|
| FR-ANL-01 | Every metric defines source, observation time, calculation, window, missing-data behavior, freshness, label and raw/calculated status. | Metric registry exists; a test fails if any displayed metric lacks a definition. | METRICS.md | 11 | R1 |
| FR-ANL-02 | Unavailable metrics remain unavailable; no invented values. | Test: missing previous value → growth is `null`/"unavailable", never `0`; previous = 0 → percentage growth unavailable. | METRICS.md | 11 | R1 |
| FR-RANK-01 | Every ranking declares metric, window, eligible population, freshness rule, tie-break and methodology version. | Ranking responses/pages include methodology version; deterministic tie-break test passes. | RANKINGS.md | 11 | R1 |
| FR-TRND-01 | Trending is a versioned, documented calculated signal, labelled as not official Telegram data. | Methodology page lists inputs/weights/windows; UI label present (E2E check). | TRENDING.md | 11 | R1 |

### 2.4 Search and public web

| ID | Requirement | Acceptance criteria | Source | Phase | Rel |
|---|---|---|---|---|---|
| FR-SRCH-01 | Search by name/username/keyword with autocomplete. | Integration test returns expected fixtures; autocomplete responds within NFR-PERF-01. | PHASE-12 | 12 | R1 |
| FR-SRCH-02 | Filters and cursor pagination on all result lists. | Test: page size is capped; cursor walk returns every row exactly once. | PHASE-12, POSTGRESQL.md | 12 | R1 |
| FR-PROF-01 | Public entity page shows identity → primary metrics → growth → post analytics → recent posts. | E2E renders each section, including loading/empty/error/retry states. | UI-UX.md, ROUTES.md | 13, 15 | R1 |
| FR-PROF-02 | Public routes in `ROUTES.md` exist and read server-side from cache/DB. | E2E visits each public route; no live Telegram call per page view. | ROUTES.md, DATA-FLOW.md | 13 | R1 |
| FR-SEO-01 | Unique title/description/canonical/robots/OG/JSON-LD/breadcrumbs, sitemap and robots.txt; only meaningful pages indexable. | Automated SEO check per route template; entities below the indexation threshold (OD-008) emit `noindex` and are excluded from the sitemap. | SEO.md | 14 | R1 |

### 2.5 Accounts, dashboard, watchlists, alerts, bot

| ID | Requirement | Acceptance criteria | Source | Phase | Rel |
|---|---|---|---|---|---|
| FR-AUTH-01 | Registration, email verification, login, logout, password reset. | E2E for each flow; reset tokens are single-use and expire. | PHASE-16, ASVS-CHECKLIST.md | 16 | R1 |
| FR-AUTH-02 | Secure sessions (secure cookies, CSRF strategy). | Cookies are `HttpOnly`/`Secure`/`SameSite`; a state-changing request without a CSRF token is rejected. | SECURITY.md | 16 | R1 |
| FR-AUTH-03 | RBAC with server-side and object-level authorization; privileged actions audited. | Test: user A cannot read/modify user B's watchlist/alerts/keys (IDOR test) → 403/404. | PHASE-17, SECURITY.md | 17 | R1 |
| FR-DASH-01 | Protected dashboard routes in `ROUTES.md`. | Unauthenticated access redirects to login; E2E covers each route. | ROUTES.md | 18 | R1 |
| FR-WL-01 | Users add/remove tracked entities. | API `GET/POST/DELETE /watchlist` integration tests pass. | API.md | 19 | R1 |
| FR-WL-02 | Duplicate watchlist adds are idempotent; plan limits enforced. | Test: double add → one row; add over limit → entitlement error. | PHASE-19 | 19, 25 | R1 |
| FR-ALRT-01 | Users create/update/delete alert rules. | `GET/POST/PATCH/DELETE /alerts` integration tests pass. | API.md | 20 | R1 |
| FR-ALRT-02 | Alert evaluation is event-driven and idempotent. | Test: the same metric event processed twice → one alert event. | DATA-FLOW.md | 20 | R1 |
| FR-ALRT-03 | Notifications are queued and delivered via adapters. | Test: delivery-adapter failure → retried within bounds, then DLQ. | DATA-FLOW.md | 20 | R1 |
| FR-BOT-01 | Bot commands are a thin interface over shared services. | No business logic in `apps/bot` (review + unit tests call shared services). | SERVICE-BOUNDARIES.md | 21 | R1 |
| FR-BOT-02 | Bot can deliver alerts to linked accounts. | Integration test: linked account receives an alert; unlinked does not. | PHASE-21 | 21 | R1 |

### 2.6 API, keys, billing, entitlements, exports

| ID | Requirement | Acceptance criteria | Source | Phase | Rel |
|---|---|---|---|---|---|
| FR-API-01 | Versioned `/api/v1` endpoints listed in `API.md` with OpenAPI. | OpenAPI document validates; contract tests cover each endpoint. | API.md, ADR-003 | 22 | R1 |
| FR-API-02 | Validation, pagination, stable error format and request IDs on every endpoint. | Test: invalid input → 400 with stable error code; every response carries a request ID. | API.md | 22 | R1 |
| FR-API-03 | Backward compatibility of the public API. | CI contract diff fails on a breaking change to `/api/v1`. | ADR-003 | 22, 29 | R1 |
| FR-KEY-01 | API keys stored hashed with prefix; secret shown once. | DB inspection test: no raw secret stored; only `prefix` + `secret_hash`. | API-SECURITY.md | 23 | R1 |
| FR-KEY-02 | Scopes, expiry and revocation enforced server-side. | Test: revoked/expired key → 401; out-of-scope call → 403. | API-SECURITY.md | 23 | R1 |
| FR-KEY-03 | Per-key rate limits and quotas with usage recording. | Test: exceeding the limit → 429 with a documented error; usage rows recorded. | API-SECURITY.md | 23 | R1 |
| FR-BILL-01 | Payment provider abstraction and checkout (provider: OD-007). | Checkout integration test against the provider sandbox/mock. | PHASE-24 | 24 | R1 |
| FR-BILL-02 | Paid access granted only from verified webhooks, never from browser redirects. | Test: redirect without webhook → no entitlement; forged webhook signature → rejected; replayed webhook → idempotent. | CLAUDE.md, SECURITY.md | 24 | R1 |
| FR-BILL-03 | Subscription lifecycle (create, renew, cancel, fail) recorded as events. | Test for each lifecycle event → correct subscription state. | POSTGRESQL.md | 24 | R1 |
| FR-ENT-01 | Centralized entitlement evaluation for all plan-limited features. | Test: every limited feature calls the entitlement service (no inline plan checks). | PHASE-25 | 25 | R1 |
| FR-EXP-01 | Exports generated asynchronously by a worker. | Test: export request returns a job reference; the file is produced by `exports.generate`. | QUEUE-ARCHITECTURE.md | 18, 25 | R1 |

### 2.7 Admin, moderation, observability

| ID | Requirement | Acceptance criteria | Source | Phase | Rel |
|---|---|---|---|---|---|
| FR-ADM-01 | Admin views for channels, users, jobs, workers, payments, audit, system. | E2E per admin route; non-admin → 403. | ROUTES.md | 26 | R1 |
| FR-ADM-02 | Privileged actions require confirmation and are audited. | Test: each privileged action writes an `audit_logs` row with actor, action, target and time. | PHASE-26 | 26 | R1 |
| FR-MOD-01 | Moderators can hide/exclude an entity and process removal/opt-out requests per `DATA-POLICY.md`. | Test: hidden entity → absent from search, sitemap and public API; action audited. (Removal-request rules pending OD-004.) | PRD users, DATA-POLICY.md | 26 | R1 |
| FR-OBS-01 | Structured logs, metrics, error tracking, health/readiness/liveness endpoints. | Health endpoints return correct status when a dependency is down; log scan finds no secrets/tokens/auth headers. | OBSERVABILITY.md | 27 | R1 |

## 3. Non-functional requirements

Numeric targets marked **TBD** are open owner decisions (OD-005). They are not invented here; each must be set before the phase that verifies it.

| ID | Category | Requirement | Target | Verified in |
|---|---|---|---|---|
| NFR-PERF-01 | Performance | Public page and API read latency | p95 TBD ms (OD-005) | 32, 35 |
| NFR-PERF-02 | Performance | No unbounded queries/payloads; all large collections paginated with a capped page size | Max page size TBD (OD-005) | 12, 22 |
| NFR-PERF-03 | Performance | Expensive work runs asynchronously in workers | Qualitative | 08 |
| NFR-SCAL-01 | Scalability | Horizontal scaling of web/API/workers; modular monolith first (ADR-001) | Target entity count/ingest rate TBD (OD-005) | 33 |
| NFR-FRESH-01 | Freshness | Metrics refreshed per schedule; staleness shown to users | Refresh interval per tier TBD (OD-005) | 10 |
| NFR-AVAIL-01 | Availability | Public site/API availability | SLO TBD (OD-005) | 31, 37 |
| NFR-REC-01 | Recoverability | Daily backups, off-server copy, tested restore | RPO/RTO TBD (OD-005); retention 7d/4w/3m (BACKUPS.md) | 34 |
| NFR-SEC-01 | Security | OWASP ASVS baseline; controls listed in SECURITY.md | ASVS level TBD (OD-005) | 28 |
| NFR-SEC-02 | Security | No secrets in repo/logs; secrets from a secret store | Zero findings from the secret scan | every phase |
| NFR-A11Y-01 | Accessibility | Accessible controls and states | WCAG level TBD (OD-005) | 15, 36 |
| NFR-UX-01 | Responsiveness | Mobile-first; loading/success/empty/error/retry states | Qualitative + E2E mobile viewport | 15 |
| NFR-SEO-01 | SEO | SEO.md rules; no thin pages | Indexation threshold TBD (OD-008) | 14 |
| NFR-OBS-01 | Observability | Monitoring per OBSERVABILITY.md | Alert thresholds TBD (OD-005) | 27 |
| NFR-COMP-01 | Compatibility | Public API backward compatible within `/api/v1` | Zero breaking changes without a new version | 22, 29 |
| NFR-TG-01 | Provider compliance | Respect Telegram rate limits and terms; no limit evasion | Zero forced retries within provider-given waits | 06 |

## 4. Phase-level acceptance criteria (PHASE-00)

See `docs/phases/PHASE-00-ACCEPTANCE.md`. Evidence:

| Area | Location |
|---|---|
| Product boundary | `PRD.md` §3 |
| MVP | `PRD.md` §6, this file §2 (`Rel` column) |
| Non-goals | `PRD.md` §7 |
| User journeys | `PRD.md` §8 |
| NFRs | this file §3 |
| Acceptance criteria | this file §2 |
| Data policy | `DATA-POLICY.md` |
