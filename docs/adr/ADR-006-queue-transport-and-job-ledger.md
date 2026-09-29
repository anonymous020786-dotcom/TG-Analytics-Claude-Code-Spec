# ADR-006 — Queue Transport and Durable Job Ledger

Status: Accepted (D-011, 2026-09-29)

## Context

QUEUE-ARCHITECTURE.md requires durable queues, bounded retries, a DLQ and idempotent jobs. ADR-004 requires durable job status. POSTGRESQL.md already defines `jobs`, `job_attempts` and `dead_letter_jobs`. DEPLOYMENT.md's initial topology includes Redis, and no other queue broker.

## Decision

- **Transport:** a Redis-backed job queue library for the Node.js/TypeScript stack, running on the Redis already in the deployment. The specific library is chosen in PHASE-02/08.
- **Ledger:** PostgreSQL `jobs` / `job_attempts` / `dead_letter_jobs` is the durable record of job status, attempts and DLQ, written in the same transaction as the business side effect where possible.
- If Redis is lost, pending jobs can be re-enqueued from the ledger.

## Consequences

- No new infrastructure beyond the initial topology.
- Redis must be configured for persistence appropriate to queue use. That is a PHASE-31 check.
- There are two stores to keep consistent; reconciliation of the ledger against the transport is part of PHASE-09.

## Alternatives considered

- PostgreSQL-only queue: one fewer moving part, but more database load at high job volume.
- A dedicated broker (e.g. RabbitMQ, Kafka): not justified without measured need (CLAUDE.md, ADR-001).

## Update — PHASE-08 (2026-09-29)

- Library: BullMQ 6.3.8 with ioredis on Redis 8 (newest releases passing the 7-day `minimumReleaseAge`).
- Consistency between ledger and transport is handled with an outbox dispatcher (`dispatched_at` + `FOR UPDATE SKIP LOCKED` + stale re-dispatch) rather than dual writes. The ledger stays the source of truth and the transport can be rebuilt from it.
- Remaining reconciliation (jobs stuck in `running` after a crash) is PHASE-09.
