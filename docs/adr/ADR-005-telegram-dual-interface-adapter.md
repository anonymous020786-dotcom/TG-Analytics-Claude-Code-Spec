# ADR-005 — Telegram Access via Dual-Interface Adapter

Status: Accepted (D-001, 2026-09-29)

## Context

The product needs public channel and group data (D-002) and a user-facing bot. The Telegram Bot API suits the bot but does not cover every public-entity read the product needs. The MTProto client API covers more public data, but requires Telegram-issued `api_id`/`api_hash`, logged-in accounts and compliance with Telegram API Terms of Service. CLAUDE.md forbids browser scraping as the primary architecture and forbids asserting unsupported API capabilities.

## Decision

- All Telegram access goes through one `TelegramClientAdapter` contract (INTEGRATION.md). It has two backend implementations, Bot API and MTProto, selected per operation by a capability map.
- The capability map records, per operation, which backend is used. It is populated only from verified official documentation and tests in PHASE-06, not assumed here.
- Both backends share the `TelegramRateLimiter` and `TelegramErrorClassifier`. Rate-limit state is tracked per backend, per credential/account and per method (RATE-LIMITING.md).
- The bot (`apps/bot`) uses the Bot API backend only. Collectors may use either backend.
- MTProto credentials and session files are secrets held in the secret store; they never appear in logs or the repository.
- Library selection (e.g. which MTProto client library) is a PHASE-06 decision, recorded as an ADR update.

## Consequences

- Controllers and domain code stay provider-agnostic, and each backend can be tested with recorded fixtures.
- Operational dependency on MTProto accounts (OD-003) must be resolved before any MTProto collector runs.
- Losing one backend degrades only the operations mapped to it.

## Alternatives considered

- Bot API only: has no general method to read the message history of public channels or groups the bot is not part of, so it does not meet the product scope. The exact limits are verified in PHASE-06.
- MTProto only: the bot would need a separate path anyway.
- Web scraping: forbidden by CLAUDE.md.
