# System Architecture

Status: PHASE-01 baseline. Decisions: ADR-001..007. Product scope: `docs/product/PRD.md`.

## 1. Overview

```text
Telegram supported interfaces (Bot API + MTProto, ADR-005)
-> discovery/ingestion workers
-> durable queues (ADR-006)
-> PostgreSQL + analytical store (ADR-002) + object storage
-> analytics engine
-> search/API/cache
-> Next.js public site/dashboard/admin
-> Telegram bot/users.
```

Start as a modular monolith plus workers (ADR-001). Extract services only after measured bottlenecks.

**Naming:** "channel" in queue names, table names and code identifiers means any in-scope Telegram entity, whether a public channel or a public group (D-002). Existing identifiers such as `channel.metrics` and `channels` are kept for compatibility.

## 2. Components

| ID | Component | Location | Kind | Responsibility | Talks to |
|---|---|---|---|---|---|
| C1 | Web | `apps/web` | Next.js process | Public site, dashboard, admin UI (ADR-007); presentation only | C2 (HTTP) |
| C2 | API | `apps/api` | NestJS process | `/api/v1` public API, internal endpoints for C1/C3, application + domain services, authorization | PostgreSQL, analytical store, Redis, queues (produce), search adapter |
| C3 | Bot | `apps/bot` | Process | Telegram bot commands; thin interface over shared services (via C2 or shared packages, see §4) | Telegram Bot API adapter, C2 |
| C4 | Admin | `apps/admin` | Placeholder | Reserved; admin UI is hosted in C1 initially (ADR-007) | — |
| C5 | Scheduler | Process entry point (location fixed in PHASE-02) | Process | Enqueues due jobs only; no business logic, no external calls | PostgreSQL (read schedules), queues (produce) |
| C6 | Workers | `workers/*` | Processes | Asynchronous external/data processing; one worker type per queue (see QUEUE-ARCHITECTURE.md) | Adapters, PostgreSQL, analytical store, queues, object storage |
| C7 | PostgreSQL | Infrastructure | Datastore | Transactional source of truth, job ledger (ADR-002, ADR-006) | — |
| C8 | Analytical store | Infrastructure | Datastore | Append-only historical snapshots behind the `AnalyticsStore` interface (ADR-002). PostgreSQL tables first; ClickHouse only when measured load justifies it (ADR-011) | — |
| C9 | Redis | Infrastructure | Datastore | Cache, rate-limiter state, queue transport (ADR-006) | — |
| C10 | Object storage | Infrastructure | Datastore | Export files and other generated artifacts; no copied Telegram media (DATA-POLICY §4) | — |
| C11 | Search index | Infrastructure / adapter | Datastore | Entity search; engine chosen in PHASE-12 behind an adapter | — |
| C12 | External providers | Outside | Adapters | Telegram (Bot API, MTProto), payments, email | Only via `packages/*` adapters |

Shared packages (`packages/*`) are libraries, not processes: `types`, `validation`, `database`, `analytics`, `queues`, `auth`, `security`, `logging`, `ui`. Their allowed dependencies are defined in SERVICE-BOUNDARIES.md.

## 3. Deployment view (initial)

```text
Internet -> Cloudflare -> Nginx -> { web (C1), api (C2) }
Private network: api, bot, scheduler, workers <-> PostgreSQL, Redis, analytical store, search, object storage
Outbound only: workers/bot -> Telegram; api -> payment/email providers
```

PostgreSQL, Redis, the analytical store and search are never publicly exposed (DEPLOYMENT.md). Only C1 and C2 accept inbound internet traffic, plus inbound provider webhooks (payments; Telegram bot webhook if used), which go to C2.

## 4. Dependency rules

1. C1 never accesses datastores directly; it reads and writes through C2. This keeps authorization server-side in one place.
2. C3 (bot) calls shared application services. The first implementation calls C2 internal endpoints; in-process use of shared packages is allowed only if authorization stays in the shared service (decided in PHASE-21).
3. Workers and C2 share domain/application packages; neither imports the other's process code.
4. Only adapter packages import provider SDKs (Telegram, payments, email, search, object storage).
5. No component makes a live Telegram call to serve a page or API read (DATA-FLOW.md).

## 5. Failure domains

| Failure | Blast radius | Expected behavior |
|---|---|---|
| Telegram unavailable / rate-limited | Collection only | Workers classify, back off and reschedule; public reads serve last observations with freshness shown; history kept. |
| One MTProto account banned/limited | That account's jobs | Rate-limiter/account state marks it unavailable; jobs reschedule to other capacity or wait; never evades limits (OD-003). |
| Worker crash mid-job | That job | Job redelivered; idempotency key prevents duplicate side effects (ADR-004). |
| Redis down | Cache, queues, rate limits | Reads fall back to databases with degraded latency; enqueue fails fast with a clear error; job ledger in PostgreSQL survives (ADR-006). |
| PostgreSQL down | Writes and most reads | API returns 503 via readiness; workers pause; no data loss beyond RPO (OD-005). |
| Analytical store down | Charts/history | Entity pages render identity/current data with "history unavailable"; snapshot writes retried (bounded) then DLQ. |
| Search down | Search/autocomplete | Search returns a stable error; other pages unaffected; `search.index` jobs retried later. |
| Payment provider down / webhook delayed | Upgrades | No entitlement until a verified webhook arrives; checkout shows pending. |
| Email/notification provider down | Notifications | Delivery retried within bounds, then DLQ; alert events are not lost. |
| Web (C1) down | Public UX | API and bot unaffected. |

## 6. Scale-out rules

1. **Stateless processes scale horizontally:** web, API, bot (webhook mode) and workers. Session state lives in PostgreSQL/Redis, not process memory.
2. **Workers scale per queue**, independently, based on queue depth and latency (metrics defined in PHASE-27). Telegram-facing workers are capped by the Telegram rate limiter, not by CPU. Adding workers must not increase Telegram request rate beyond the limiter.
3. **Only one scheduler instance may enqueue a given schedule tick at a time**, enforced by a lock or lease (PHASE-09). Duplicate enqueues are harmless because of idempotency keys.
4. **Read scaling order:** CDN/HTTP cache → Redis cache → read replica → analytical store. Add each only after measurement.
5. **Service extraction** (ADR-001) is allowed only when a measured bottleneck or team boundary justifies it, and must be recorded as an ADR.
6. **Numeric capacity targets** come from OD-005 and are validated in PHASE-32/33.
