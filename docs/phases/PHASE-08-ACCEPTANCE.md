# Phase 08 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Durable jobs | Ledger is the source of truth; transport carries ids only | Outbox `Dispatcher`; `job-ledger.test.ts` (9) |
| No double dispatch | Concurrent dispatchers never claim the same job | 20 jobs / 2 dispatchers test |
| Lost-push recovery | Stale dispatches re-claimed | Ledger test |
| Idempotent execution | Duplicate delivery runs once | Concurrent `startAttempt` test; `skipped` path |
| Payload validation | Versioned, strict schemas; poisoned payloads fail `invalid_input` without running | `runtime.test.ts` |
| Rate limits | Rescheduled at provider time, attempt not consumed, capped | Ledger + runtime tests |
| Bounded retries | No unbounded retry anywhere | `attempt < max_attempts`; reschedule cap; BullMQ `attempts: 1` |
| Collectors | Metadata refresh and member-count snapshots with provenance; failures recorded, history kept | Worker tests (6 + 3); discovery (8) |
| Transport | Real Redis delivery and dedup | `bullmq-transport.test.ts` |
| Worker lifecycle | Typed config, bounded concurrency, graceful shutdown | `worker.test.ts`; `handleShutdown` test |
| Live pipeline | Real workers process real jobs end to end | Local run: 2 metadata + 2 metrics jobs succeeded; `members` snapshots for `@telegram` and `BotTalk`; secrets redacted in logs |
| Security | Redis password-protected, localhost-only; secrets redacted in ledger/logs | `NOAUTH` check; `safeMessage` test |
| Deferred | Scheduler, stuck-job recovery, DLQ/backoff/re-drive, shared rate limiter (PHASE-09); worker container images (PHASE-11B/29) | Documented |
