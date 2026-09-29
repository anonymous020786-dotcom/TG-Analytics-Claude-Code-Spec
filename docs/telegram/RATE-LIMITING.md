# Rate Limiting

Dimensions can include global, account/session, method, channel and job priority.

On rate-limit signals: classify -> persist state -> backoff -> reschedule. Prevent synchronized retry storms. Never defeat provider limits.

## Implementation (PHASE-06, PHASE-09)

- `RedisRateLimiter` (`@tga/adapter-telegram`) holds one token bucket and penalty window per `backend:credential` in Redis. It updates them atomically with a Lua script using Redis `TIME`, so every worker process shares the same budget and clock.
- Provider signals (`429 retry_after`, `FLOOD_WAIT_X`) penalize the key for at least the provider wait. Denials return a jittered wait, and callers reschedule; they never sleep.
- It fails closed: if Redis is unavailable, no Telegram call is made (`dependency_down`).
- `InMemoryRateLimiter` remains for tests and single-process tools.
