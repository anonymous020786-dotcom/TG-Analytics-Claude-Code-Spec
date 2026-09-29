# Telegram Capability Matrix

Status: PHASE-05A spike, 2026-09-29. Consumed by PHASE-06 (ADR-005): the adapter may only rely on capabilities marked **Verified**. Everything else must be re-verified before a collector depends on it.

Evidence levels:

- **Verified (live):** called against Telegram during the spike with a dedicated test bot.
- **Documented:** stated on core.telegram.org; not yet exercised live.
- **Unknown:** not stated in the documentation; must be tested live.

## 1. Operations

| Operation | Bot API | MTProto | Use in product |
|---|---|---|---|
| Resolve public `@username` → entity (channel or group) without joining | **Verified (live)**: `getChat` on `@telegram` (channel) and `@BotTalk` (supergroup) | Documented: `contacts.resolveUsername` | Discovery (PHASE-07) via Bot API |
| Entity metadata: id, type, title, username, active usernames, description, photo, `has_visible_history`, `linked_chat_id` | **Verified (live)**: `getChat` → `ChatFullInfo` | Documented: `channel` / `channelFull` | Metadata collector via Bot API |
| Subscriber/member count | **Verified (live)**: `getChatMemberCount` (`@telegram` 9,443,724; `@BotTalk` 26,507) | Documented: `channelFull.participants_count` (flag-conditional) | `members` snapshots via Bot API |
| Verified / scam / fake flags | Not present in live `ChatFullInfo` responses | Documented: `channel.verified`, `.scam`, `.fake` | Needs MTProto (OD-003) |
| Channel/group message history | **None.** No method to read history of chats the bot is not in (Bot API docs) | Documented: `messages.getHistory`, **users only** (bots cannot call it) | Needs an MTProto user account (OD-003) |
| Reading history of a public channel **without joining** | n/a | **Unknown**: docs list `CHANNEL_PRIVATE` ("You haven't joined") but do not state behaviour for public channels | Must be tested live before PHASE-08 |
| Post views / forwards | **None**: `Message` has no view count | Documented: `message.views`, `.forwards` (channel posts only) | Needs MTProto (OD-003) |
| Post replies / reactions | None for non-member chats | Documented: `message.replies`, `.reactions` | Needs MTProto (OD-003) |
| Full channel info | n/a | Documented: `channels.getFullChannel` (users and bots); errors `CHANNEL_PRIVATE`, `CHANNEL_INVALID`, `CHANNEL_PUBLIC_GROUP_NA` | Optional; test live |
| Unknown username | **Verified (live)**: `400 Bad Request: chat not found` | Documented: `USERNAME_NOT_OCCUPIED` / `USERNAME_INVALID` | Classify `invalid_input` (no retry) |

## 2. Type mapping (Bot API → schema)

| Bot API | `channels` column | Notes |
|---|---|---|
| `id` (e.g. `-1001005640892`) | `telegram_id` | Stable canonical identity (DISCOVERY.md). Stored as the Bot API value; MTProto uses the bare channel id. PHASE-06 must define one normalization. |
| `type`: `channel` | `type = 'channel'` | |
| `type`: `supergroup` / `group` | `type = 'group'` | D-002. Only public groups (with a `username`) are in scope. |
| `username` | `username` (lowercased) | Current username; history in `channel_aliases`. |
| `title`, `description` | `title`, `description` | Untrusted text: always escaped on render (THREAT-MODEL T03). |
| `getChatMemberCount` | `member_count` + `members` snapshot | |

## 3. Rate limits and errors

| Source | Rule | Adapter behaviour |
|---|---|---|
| Bot API FAQ | ≈1 msg/s per chat, 20 msg/min per group, ≈30 msg/s broadcast. These apply to *sending*; read-method limits are not published. | Shared limiter; conservative defaults; tune from observed `retry_after`. |
| Bot API (live) | `429 Too Many Requests` with `parameters.retry_after` (seconds) | Class `rate_limited`; never retry before `retry_after`. |
| MTProto errors page | `420 FLOOD_WAIT_X`: wait X seconds; also `FLOOD_PREMIUM_WAIT_X`, `SLOWMODE_WAIT_X` | Class `rate_limited`; reschedule ≥ X s. |
| MTProto errors page | 400 bad request, 401 unauthorized, 403 forbidden, 406 not acceptable, 500 internal | 400/406 → `invalid_input`; 401/403 → `authorization`; 500 → `transient`. |

**Spike finding:** the first probe used a bot token shared with another project and got `429 retry after ~30s` on the **first** `getChat` call. A dedicated token worked immediately. Rate limits are per token, so this project needs its own credentials (D-015).

## 4. Terms and policy constraints

| Source | Constraint | Consequence for this product |
|---|---|---|
| API ToS 1.5 | Data from Telegram must not be used to train, fine-tune or develop AI | New non-goal: no AI/ML training on collected data (D-016) |
| API ToS 1.1, 1.4 | Guard user privacy; no actions on behalf of a user without their knowledge and consent | MTProto collection only from a dedicated account owned by the operator (OD-003); no member lists (DATA-POLICY §4) |
| API ToS 2.1 | Obtain your own `api_id` for your application | This product needs its own `api_id`, not one shared with another app (OD-003) |
| API ToS 4.2 | Access is discontinued if flagged issues are not fixed within 10 days | Keep a contact channel and treat notices as incidents |
| Bot FAQ | Privacy mode limits what bots see in groups; bots never see other bots' messages | Bots are not a group-message source (consistent with D-006) |

## 5. Sources

- <https://core.telegram.org/bots/api>: `getChat`, `ChatFullInfo`, `Message`
- <https://core.telegram.org/bots/faq>: limits, privacy mode
- <https://core.telegram.org/api/terms>: API Terms of Service
- <https://core.telegram.org/api/errors>: error classes, `FLOOD_WAIT_X`
- <https://core.telegram.org/constructor/message>, `/constructor/channel`, `/constructor/channelFull`
- <https://core.telegram.org/method/messages.getHistory>, `/method/channels.getFullChannel`
- Live probe: `scripts/spikes/telegram-botapi-probe.mjs` (read-only; reads the token from `.env`; never prints it)
