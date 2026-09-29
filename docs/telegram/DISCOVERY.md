# Discovery

public URL/username -> normalize -> validate -> resolve -> supported/public scope check -> map -> upsert -> schedule.

Stable Telegram identity is canonical. Username changes are aliases, not automatically new channels.

## Implementation (PHASE-07)

| Step | Where | Behaviour |
|---|---|---|
| Normalize + validate | `@tga/validation` `normalizeTelegramReference` | Accepts `name`, `@name`, `t.me`/`telegram.me`/`telegram.dog` links, `t.me/s/name`, post links, `tg://resolve`. Rejects invite links, `t.me/c/…`, non-Telegram hosts, credentials/ports in URLs and bad usernames, all with **no network call**. |
| Resolve + scope check | `@tga/adapter-telegram` `resolvePublicEntity` | Public channels and groups only (`not_public` otherwise); rate-limited, bounded retries. |
| Map + upsert | `@tga/database` `ChannelRepository.upsertFromTelegram` | One transaction keyed on the stable Telegram ID. Every username seen is an alias; a stale holder of a reused username is released; older observations never overwrite newer metadata (`metadata_observed_at`); concurrent discoveries converge (bounded retry on conflicts). |
| Schedule | `workers/discovery` `DiscoveryService` | Enqueues `channel.metadata`, `channel.metrics`, `search.index` (and `channel.posts` only once the MTProto capability is verified) with idempotency key `discovered:<channelId>`. |
| Status changes | `DiscoveryService` | A known username that stops resolving marks the channel `inaccessible` or `not_public`; history is kept (DATA-POLICY §6). Rate limits and transient failures are rethrown for the job layer (PHASE-08/09). |
