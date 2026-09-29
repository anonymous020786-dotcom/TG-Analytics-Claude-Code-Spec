# Service Boundaries

Status: PHASE-01 baseline. Components (C1–C12) are defined in SYSTEM-ARCHITECTURE.md.

## 1. Layers

```text
Presentation -> application service -> domain service -> repository -> external adapter
```

- **Presentation:** web pages, API controllers, bot command handlers, worker job handlers. These parse and validate input, call one application service, and map the result. They contain no business rules.
- **Application service:** use-case orchestration, authorization checks, transactions, enqueueing jobs.
- **Domain service:** pure business rules (analytics calculators, entitlement evaluation, identity/alias rules). No I/O.
- **Repository:** persistence behind interfaces (PostgreSQL, analytical store).
- **External adapter:** Telegram, payments, email, object storage and search. Domain logic must not depend directly on provider SDKs.

Dependencies point only downward. Lower layers never import higher layers.

## 2. Process roles

| Process | Role |
|---|---|
| Web | Presentation only; reads/writes via API. |
| API | Application/domain access; the single place where user-facing authorization is enforced. |
| Workers | Asynchronous external/data processing. |
| Scheduler | Schedules jobs only. |
| Bot | Thin interface over shared services. |

## 3. Domain modules

Modules live inside the modular monolith (ADR-001). Each owns its tables and exposes an application-service interface; other modules never write its tables directly.

| Module | Owns (tables per POSTGRESQL.md) | Requirements | Phase |
|---|---|---|---|
| Identity & access | users, user_sessions, organizations, organization_members, roles, permissions, role_permissions | FR-AUTH-* | 16, 17 |
| Catalog | channels, channel_aliases, categories, channel_categories, posts, post_media | FR-DISC-*, FR-PROF-* | 04, 07 |
| Collection | jobs, job_attempts, dead_letter_jobs (ledger shared via `packages/queues`) | FR-TG-*, FR-ING-*, FR-DQ-* | 06, 08, 09, 10 |
| Analytics | analytical-store snapshot tables (CLICKHOUSE.md) | FR-ANL-*, FR-RANK-*, FR-TRND-* | 05, 11 |
| Search | search index (adapter) | FR-SRCH-* | 12 |
| Tracking | tracked_channels, alerts, alert_events | FR-WL-*, FR-ALRT-* | 19, 20 |
| Bot | bot_users | FR-BOT-* | 21 |
| API access | api_keys, api_usage | FR-API-*, FR-KEY-* | 22, 23 |
| Billing | plans, subscriptions, subscription_events, payments, invoices, coupons | FR-BILL-* | 24 |
| Entitlements | entitlements | FR-ENT-*, FR-EXP-* | 25 |
| Administration | audit_logs, system_settings, feature_flags | FR-ADM-*, FR-MOD-* | 26 |
| Platform / presentation | (none) | FR-OBS-*, FR-SEO-*, FR-DASH-* (dashboard is presentation in C1 over other modules) | 14, 18, 27 |

## 4. Package dependency rules

`->` means "may import".

| Package | May import | Must not import |
|---|---|---|
| `types` | nothing | everything else |
| `validation` | `types` | I/O packages |
| `logging` | `types` | app code |
| `analytics` | `types` | any I/O (pure functions only) |
| `security` | `types`, `logging` | app code |
| `auth` | `types`, `validation`, `security`, `database` | web/bot code |
| `database` | `types`, `logging` | app code, provider SDKs |
| `queues` | `types`, `validation`, `logging` | provider SDKs |
| `ui` | `types` | server-only packages (`database`, `queues`, `auth`) |
| `config` | nothing (external: `zod`) | app code; used only by process entry points to load and validate environment (PHASE-03) |
| `apps/web` | `ui`, `types`, `validation` | `database`, `queues`, provider SDKs |
| `apps/api`, `workers/*`, `apps/bot` | any `packages/*` | each other's process code |

Adapter packages for Telegram, payments, email, object storage and search are created in the phase that introduces each provider. They are the only code allowed to import that provider's SDK. PHASE-02 enforces these rules with an automated import-boundary check.

## 5. Cross-cutting contracts

- **Authorization:** enforced in application services (API); object-level checks for user-owned resources. Clients are never trusted (CLAUDE.md).
- **Validation:** every inbound boundary (HTTP, bot command, job payload, webhook) validates with `packages/validation` schemas.
- **Idempotency:** every side-effecting job and webhook handler carries an idempotency key (ADR-004).
- **Observability:** every request/job carries `trace_id`/request ID through logs (`packages/logging`).
- **Feature flags:** risky behavior (new collectors, methodology changes) is guarded by `feature_flags` (CLAUDE.md).
