# Queue Architecture

Status: PHASE-01 baseline. Transport and job ledger: ADR-006. Idempotency: ADR-004. "channel" means channel or group (D-002).

## 1. Queue catalog

| Queue | Producer | Consumer | Idempotency key | Side effects | Telegram-facing | Phase |
|---|---|---|---|---|---|---|
| `channel.discovery` | API, scheduler | `workers/discovery` | normalized username | upsert entity/alias | yes | 07 |
| `channel.metadata` | discovery, scheduler | `workers/metadata` | entity_id + schedule window | update metadata, alias | yes | 08 |
| `channel.posts` | discovery, scheduler | `workers/posts` | entity_id + schedule window | upsert posts, post snapshots | yes | 08 |
| `channel.metrics` | discovery, scheduler | `workers/metrics` | entity_id + schedule window | append metric snapshots | yes | 08 |
| `analytics.process` | metrics/posts workers | `workers/analytics` | entity_id + observation id + methodology version | derived metrics | no | 11 |
| `ranking.compute` **(added)** | scheduler, analytics worker | `workers/ranking` | ranking id + window + methodology version | ranking snapshots | no | 11 |
| `search.index` | discovery, metadata, analytics | `workers/search` | entity_id + entity version | index upsert/delete | no | 12 |
| `notifications.evaluate` | analytics worker | `workers/notifications` | entity_id + observation id | alert_events rows | no | 20 |
| `notifications.deliver` **(added)** | notifications evaluate step | `workers/notifications` | alert_event_id + delivery channel | send email/bot message | no (bot delivery uses Bot API adapter) | 20 |
| `exports.generate` | API | `workers/exports` | export request id | file in object storage | no | 18 |
| `dead-letter` | any worker after retry exhaustion | admin re-drive (PHASE-09/26) | original job id | none until re-driven | — | 09 |

**Added in PHASE-01:**

- `ranking.compute`: `workers/ranking` existed with no queue feeding it.
- `notifications.deliver`: the alerts data flow requires a notification queue feeding a delivery adapter, separate from evaluation.

## 2. Job envelope

Fields: `job_id`, `type`, `entity_id`, `payload_version`, `priority`, `attempt`, `scheduled_at`, `idempotency_key`, `trace_id`.

- Payloads are validated with a versioned schema from `packages/validation` on both enqueue and consume. An unknown `payload_version` is classified `invalid_input` (guards against queue poisoning).
- Payloads carry IDs, not secrets or large blobs.

## 3. Failure classes and actions

| Class | Example | Action |
|---|---|---|
| `transient` | timeout, connection reset | Retry with bounded exponential backoff + jitter. |
| `rate_limited` | Telegram flood wait / 429 | Persist limiter state; reschedule no earlier than the provider-given delay; does not count as a normal failure attempt, but total reschedules are capped. |
| `authorization` | revoked/limited account or token | Stop; mark credential/account unavailable; alert operators; do not retry the same credential. |
| `invalid_input` | schema failure, entity not public | No retry; record status; DLQ if unexpected. |
| `dependency_down` | DB/Redis/analytical store unavailable | Retry with backoff; circuit-break to avoid storms. |
| `permanent` | entity deleted | No retry; record status; keep history (FR-DQ-02). |
| `unknown` | unclassified | Bounded retry, then DLQ with full context. |

Retry limits and backoff parameters are configuration with a mandatory maximum, never infinite (CLAUDE.md). Values are set in PHASE-09.

## 4. Durability and ordering

- The job ledger (`jobs`, `job_attempts`, `dead_letter_jobs`) in PostgreSQL is the durable record of status and attempts. The transport can be rebuilt from it (ADR-006).
- Delivery is at least once. Correctness relies on idempotency keys, not on exactly-once delivery.
- There is no global ordering guarantee. Consumers compare observation times and never overwrite newer data with older data.
- Priority: user-initiated discovery takes precedence over scheduled refresh, which takes precedence over backfill. Exact priority values are set in PHASE-08.

## 5. Concurrency

- Telegram-facing queues share the Telegram rate limiter across all worker instances (RATE-LIMITING.md).
- Per-entity mutual exclusion (lock/lease) prevents two collectors writing the same entity concurrently (PHASE-09).

## 6. Implementation (PHASE-08)

- **Transport:** BullMQ 6.3.8 on Redis 8 (ADR-006), via `@tga/queues` `BullTransport`. Messages carry only the ledger id; BullMQ job id = ledger id; BullMQ retries are off (`attempts: 1`).
- **Outbox dispatch:** producers write only the PostgreSQL ledger.
  - `Dispatcher` claims due `queued` jobs with `FOR UPDATE SKIP LOCKED`, sets `dispatched_at` and pushes them.
  - A claim older than 5 minutes that never started is dispatched again, which covers lost pushes.
- **Execution:** `ConsumerRuntime.process` runs these steps:
  1. atomic `queued → running` with `attempt < max_attempts` (duplicate deliveries are skipped);
  2. a `job_attempts` row;
  3. versioned payload validation (`PAYLOAD_SCHEMAS`, strict);
  4. the handler;
  5. the ledger outcome.
- **Failures in PHASE-08:**
  - `rate_limited` requeues at the provider-given time without consuming an attempt, capped at 20 reschedules.
  - Every other class is recorded as `failed`.
  - Backoff, DLQ, stuck-`running` recovery and re-drive are PHASE-09.
- **Consumers:** `workers/discovery` (`channel.discovery`), `workers/metadata` (`channel.metadata`), `workers/metrics` (`channel.metrics`). `workers/search` (`search.index`, PHASE-12; also queued by `channel.metadata` once per metadata version). `channel.posts` waits for OD-003; those jobs stay queued in the ledger.
- **Lifecycle:** typed config (`workerConfigShape`), bounded concurrency, graceful shutdown on SIGTERM/SIGINT (in-flight jobs finish, then connections close; 30 s cap).

## 7. Reliability (PHASE-09, ADR-012)

- **Retry policy:** `recordFailure` requeues `transient`, `dependency_down` and `unknown` failures with exponential backoff and equal jitter while attempts remain. `permanent` ends as `failed`; everything else is dead-lettered (`dead` + `dead_letter_jobs`).
- **Leases:** running jobs hold `lease_expires_at`, renewed by heartbeat. The `Reaper` (in every worker) recovers expired leases.
- **Attempt history:** one `job_attempts` row per execution with outcome, class and message; `attemptHistory(jobId)`.
- **Re-drive:** `redrive(jobId, actor)` is transactional, idempotent and audited. Operator CLI: `pnpm --filter @tga/worker-scheduler dlq:local list | redrive <jobId> --actor <id>`.
- **Scheduler:** `workers/scheduler` is a lease singleton. It uses per-window idempotency keys, never stacks jobs for an entity with an unfinished job, and works in bounded batches. Intervals are configuration (provisional, OD-005).
- **Per-entity exclusion:** enforced at scheduling. Collector writes are concurrency-safe (ADR-012).
