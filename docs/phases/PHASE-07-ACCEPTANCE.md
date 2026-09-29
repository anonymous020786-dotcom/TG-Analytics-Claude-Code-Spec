# Phase 07 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Normalization (FR-DISC-01) | URL/username variants normalize identically; invalid input rejected without a Telegram call | `@tga/validation` tests (37, incl. SSRF probes); discovery tests (no resolver calls) |
| Public scope (FR-DISC-02) | Private/invite/non-public entities rejected and not stored | Discovery tests (`invite_link`, `private_link`, `not_public`) |
| Canonical identity (FR-DISC-03) | Same Telegram ID → one row; username change → alias | `channel-identity.test.ts` (10) |
| Stale data | Older observations never overwrite newer metadata | `metadata_observed_at` + test |
| Concurrency | Concurrent discoveries converge on one row | 6-way concurrent upsert test |
| Scheduling | Follow-up jobs enqueued idempotently; posts gated on MTProto capability | Discovery tests |
| History kept | Status changes never delete data | Discovery + identity tests |
| Failure handling | Retryable failures rethrown for the job layer; scope failures final | Discovery tests |
| Migration | Additive, nullable column | `channel_metadata_observed_at` (no drift) |
| Live check | Real discovery into the local dev database | `t.me/s/telegram` → channel, `t.me/BotTalk` → group, invite link rejected, 6 jobs queued |
| Scope | No worker loop, scheduler or collectors (PHASE-08) | Diff review |
