# Phase 09 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Backoff | Retryable failures requeued with bounded exponential backoff + jitter | `computeBackoffMs` tests; ledger retry test |
| DLQ | Exhausted/non-retryable failures dead-lettered; permanent → failed | Ledger tests (transient exhaustion, authorization, invalid_input, rate-limit cap) |
| Attempt history | Every execution recorded with outcome/class/message | `attemptHistory` assertions |
| Leases | Running jobs leased and heartbeated; expired leases recovered; concurrent reapers safe | Heartbeat test (fake timers); reaper tests; `Reaper` unit test |
| Named locks | Atomic acquire/renew/expire/release; one winner under contention | `LeaseRepository` tests (8-way race) |
| Safe re-drive | Only dead jobs; idempotent; audited in the same transaction; budget reset | Re-drive tests; CLI verified |
| Scheduler | Singleton, per-window idempotent, per-entity exclusion, bounded | `scheduler.test.ts` (5); live run with two instances |
| Shared rate limit | One budget per credential across processes; atomic; provider penalties shared; fails closed | `redis-rate-limiter.test.ts` (real Redis) |
| Live check | Scheduler → workers → snapshots with shared limiter | 4 scheduled jobs succeeded; second scheduler locked out; 2 snapshots per channel; limiter key in Redis |
| Migrations | Additive (`lease_expires_at`, `leases` + CHECKs) | `reliability_leases`, no drift |
| Deferred | Admin DLQ UI (PHASE-26); metrics/alerts on DLQ depth (PHASE-27); worker container images (PHASE-11B/29) | Documented |
