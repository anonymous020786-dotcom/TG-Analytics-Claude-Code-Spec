# Phase 06 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Single integration boundary | Only the adapter talks to Telegram | `@tga/adapter-telegram`; boundary rule: provider SDKs only in `packages/adapter-*` |
| Timeouts | Every external call bounded | `AbortSignal.timeout` (10 s) on every Bot API request; timeout → `transient` |
| Bounded retries | No infinite retries; only retryable classes | `retry.test.ts` (attempt cap, class filter, backoff cap) |
| Rate limiter | Honour `retry_after` / `FLOOD_WAIT`; jitter; per credential | `rate-limiter.test.ts`; adapter 429 test blocks further calls locally |
| Error classifier | Bot API, MTProto and network errors → 7 failure classes | `errors.test.ts` |
| Input validation | Usernames validated before any network call | Adapter tests (7 invalid inputs, zero requests) |
| Untrusted payloads | Validated, bounded, public-only | `mapper.test.ts` (private/no-username rejected, malformed rejected) |
| Secrets | Token never in errors or logs | Adapter test on network error text; `sanitize` tests |
| Capability gate | Unverified MTProto operations refuse to run | Adapter tests (`capability_unverified`, `mtproto_not_configured`) |
| Live check | Real Bot API via the built adapter | Resolved `@telegram` (channel) and `BotTalk` (group), `chat_not_found` classified, member count returned |
| Scope | No discovery persistence, workers or schedulers | Diff review |
