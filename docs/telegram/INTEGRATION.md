# Telegram Integration

Use supported Telegram interfaces and only data the application is authorized to access.

Components:
TelegramClientAdapter
TelegramChannelResolver
TelegramMapper
TelegramRateLimiter
TelegramErrorClassifier

Controllers must not call Telegram SDKs directly. Track requested data, returned data, observation time, collection status and freshness.

## Implementation (PHASE-06)

Package `@tga/adapter-telegram`, the only code allowed to talk to Telegram (boundary-checked):

| Component | Implementation |
|---|---|
| TelegramClientAdapter | `TelegramClientAdapter`: capability gate → rate limiter → bounded retry → backend. Returns `Observed<T>` (value, `observedAt`, `source`). |
| TelegramChannelResolver | `validatePublicUsername`: bare/`@` usernames only, rejected before any network call. Link parsing is PHASE-07. |
| TelegramMapper | `mapBotApiChat`, `mapMtprotoChannel`, `mapMtprotoMessage`: validate untrusted payloads, bound text, canonical `telegramId` (Bot API marked id). Unreported metrics stay `undefined`, never 0. |
| TelegramRateLimiter | `InMemoryRateLimiter`: token bucket per `backend:credential`, provider penalties (`retry_after`, `FLOOD_WAIT_X`), jitter, non-blocking (callers reschedule). Shared Redis limiter in PHASE-08/09. |
| TelegramErrorClassifier | `classifyBotApiError`, `classifyMtprotoError`, `classifyNetworkError` → the 7 failure classes; `sanitize` strips tokens. |

- **Timeouts:** 10 s per Bot API request.
- **Retries:** at most 3 attempts in-call (hard ceiling 5), and only for `transient`, `dependency_down` or `unknown` errors. Rate limits are never retried in-process.
- **MTProto:** an `MtprotoTransport` interface only. No client library until OD-003 provides a dedicated account, and MTProto operations fail closed (`capability_unverified`) until verified live.
