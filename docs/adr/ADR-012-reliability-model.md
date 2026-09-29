# ADR-012 — Job Reliability Model

Status: Accepted (PHASE-09, 2026-09-29)

## Context

PHASE-09 requires backoff, a dead-letter queue, attempt history, locks/leases and safe re-drive. PHASE-08 left four gaps: jobs stuck in `running` after a crash, no periodic scheduler, per-process rate limiting, and terminal-only failures. CLAUDE.md forbids infinite retries and requires idempotent workers.

## Decision

- **Retry policy (ledger, `recordFailure`):**
  - `transient`, `dependency_down` and `unknown` failures are retried with exponential backoff and equal jitter (provisional: 30 s doubling, capped at 30 min) while `attempt < max_attempts`.
  - `permanent` failures end as `failed`.
  - Everything else, and any retryable failure that runs out of attempts, ends as `dead` with a `dead_letter_jobs` row.
  - Rate limits keep their own path: they reschedule at the provider time, don't consume attempts, and are dead-lettered after 20 reschedules.
- **Job leases:**
  - `startAttempt` sets `lease_expires_at`, and consumers heartbeat at a third of the lease (provisional lease: 2 min).
  - A `Reaper` in every worker recovers expired leases as a `transient` failure, using `SKIP LOCKED` so it's safe to run concurrently.
- **Named leases (`leases` table):** these are atomic acquire/renew/expire/release locks. They're used for the scheduler singleton.
- **Per-entity exclusion:** this is enforced **at scheduling**, not with an execution lock. The scheduler never enqueues a job for a (queue, entity) pair that already has a `queued` or `running` job. Collector writes are already concurrency-safe (transactional upserts, idempotent appends, newer-only updates), so an execution-time lock would add latency without improving correctness.
- **Safe re-drive:**
  - Only a `dead` job with an open dead-letter record can be re-driven.
  - Re-drive resets the attempt budget and is audited in the same transaction. It's idempotent.
  - Operators use `workers/scheduler` `redrive-cli` until the admin UI (PHASE-26).
- **Shared rate limiting:**
  - `RedisRateLimiter` is an atomic Lua token bucket using Redis `TIME`, so every process shares one budget per credential.
  - It fails closed: if Redis is unavailable, no Telegram call is made.
  - The `RateLimiter` interface became async. This is an internal interface, and only the adapter depends on it.

## Consequences

- A crashed worker delays a job by at most one lease plus one reaper interval.
- Dead letters are visible and re-drivable with an audit trail; nothing is silently dropped.
- Two collectors for the same channel can still overlap briefly if a reaped job and a new window coincide. Writes stay correct in that case.
- Backoff, lease and interval values are provisional until OD-005.
