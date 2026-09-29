# Data Flow

Status: PHASE-01 baseline. Queue names are defined in QUEUE-ARCHITECTURE.md; components in SYSTEM-ARCHITECTURE.md.

## 1. Discovery

`normalize -> validate -> resolve -> verify supported/public scope -> map -> upsert -> schedule jobs`

| Step | Where | Failure handling |
|---|---|---|
| Submit URL/`@username` | API (user) or scheduler (seed) | Invalid input → 400, nothing enqueued. |
| Normalize, validate | API | Reject before any Telegram call (FR-DISC-01). |
| Enqueue `channel.discovery` | API | Idempotency key = normalized username; duplicate submissions collapse. |
| Resolve via adapter | discovery worker | Classified errors; rate-limited → reschedule. |
| Scope check (public channel/group only) | discovery worker | Non-public → recorded as rejected, not stored as an entity (FR-DISC-02). |
| Map + upsert by stable Telegram ID | discovery worker | Username change → alias row, no new entity (FR-DISC-03). |
| Schedule follow-up jobs | discovery worker | Enqueue `channel.metadata`, `channel.metrics`, `channel.posts`, `search.index`. |

## 2. Metrics collection

`collect -> validate -> deduplicate -> append snapshot -> analytics event -> aggregation -> cache invalidation/index update`

1. The scheduler enqueues `channel.metrics` / `channel.posts` / `channel.metadata` for due entities.
2. The worker calls the Telegram adapter, which is rate-limited and has timeouts.
3. The worker validates the response and records provenance (requested, returned, observed_at, status).
4. It deduplicates by (entity, metric, observation window) and appends a snapshot to the analytical store. Snapshots are never overwritten.
5. It updates current values and the freshness/collection status in PostgreSQL.
6. It enqueues `analytics.process`, which recomputes derived metrics, then `ranking.compute`, `search.index` and `notifications.evaluate`, and invalidates cache keys for the affected entity.
7. If collection fails, it records status `failed` and **keeps prior observations** (FR-DQ-02).

## 3. Alerts

`metric event -> rule evaluation -> idempotent alert event -> notification queue -> delivery adapter`

1. `notifications.evaluate` loads the active rules for the entity and evaluates them against the new metrics.
2. Each match inserts an `alert_events` row keyed by (rule, observation) to prevent duplicates (FR-ALRT-02).
3. It enqueues `notifications.deliver` per channel (email, bot).
4. The delivery adapter sends the message; failures are retried with bounds, then go to the DLQ (FR-ALRT-03).

## 4. Public reads

`CDN/cache -> Next.js -> API -> Redis -> PostgreSQL/analytical store`

- Web renders server-side and fetches from the API. The API reads Redis first, then the databases.
- No live Telegram call is made for any page or API read.
- Every response includes freshness (last observed time, collection status) (FR-DQ-01).

## 5. Authenticated writes (watchlist, alerts, API keys)

`Web/Bot/API client -> API (authN -> validate -> authZ incl. object-level -> entitlement check) -> PostgreSQL (transaction) -> audit/log`

Duplicate adds are idempotent (FR-WL-02). Plan limits are evaluated by the entitlement service (FR-ENT-01).

## 6. Payment webhooks

`Provider -> API webhook endpoint -> verify signature -> idempotency check (provider event ID) -> subscription_events -> subscription state -> entitlements`

A browser redirect after checkout never grants access (FR-BILL-02). Unverified or replayed events are rejected or ignored and logged.

## 7. Public API (API keys)

`Client -> API -> key prefix lookup -> hash compare -> scope check -> rate limit/quota (Redis) -> handler -> api_usage record`

## 8. Exports

`Dashboard -> API (entitlement check) -> exports.generate -> worker builds file -> object storage -> signed, expiring download link`

## 9. Bot

`Telegram -> bot (command parse/validate) -> shared service/API -> reply`. Alert delivery to bot users goes through `notifications.deliver`.
