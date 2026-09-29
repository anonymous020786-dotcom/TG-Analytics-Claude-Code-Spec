# Data Policy

Status: PHASE-00 draft. Rules marked **Default** are conservative defaults derived from the existing spec (PRD non-goals, CLAUDE.md, INTEGRATION.md, METRICS.md). The owner may change them via the listed OD. Rules marked **Decided** reflect a logged owner decision.

## 1. Principles

1. Collect only public data that the application is authorized to access through supported Telegram interfaces (INTEGRATION.md, CLAUDE.md).
2. Never collect private, unauthorized or access-controlled data; never bypass Telegram restrictions or rate limits.
3. Record provenance for every observation: requested data, returned data, observation time, collection status, freshness (INTEGRATION.md).
4. Never fabricate values; unavailable data stays unavailable (METRICS.md).
5. Historical observations are append-only and are not deleted merely because collection failed (CLAUDE.md).
6. Minimize personal data: analytics are about channels/groups, not individual people.

## 2. Collection sources (Decided — D-001)

| Interface | Intended use | Constraints |
|---|---|---|
| Telegram Bot API | Bot user interaction (FR-BOT-*); public entity lookups where the Bot API supports them. | Bot token from BotFather held in a secret store; honor Bot API rate limits. |
| MTProto client API | Reading public channel/group metadata, counts and public message history not available via the Bot API. | Requires `api_id`/`api_hash` issued by Telegram and one or more logged-in accounts; must comply with Telegram API Terms of Service; honor `FLOOD_WAIT`; never join or read private entities; session files are secrets. |

Exact per-interface capabilities (which fields/methods are available for public entities) are **not asserted here**. They must be verified against official Telegram documentation and recorded in PHASE-06 before any collector relies on them. Browser/HTML scraping is not a primary source (CLAUDE.md).

MTProto account ownership, count and operational safety are open (OD-003).

## 3. Entity scope (Decided — D-002)

- In scope: **public** channels and **public** groups/supergroups with a public username.
- Out of scope: private/invite-only entities, secret chats, direct messages, and any entity that loses public status (collection stops; see §6).

## 4. Data classes

| Class | Examples | Channels | Groups | Rule |
|---|---|---|---|---|
| Entity metadata | Telegram ID, username(s), title, description, avatar, type, verified/scam flags where public | Collect | Collect | Default |
| Entity counters | Subscriber/member count | Collect as snapshots | Collect as snapshots | Default |
| Post/message metrics | Views, forwards, reactions, reply counts where publicly exposed | Collect as snapshots | Aggregate activity only (e.g. message volume per window) | Default (OD-004) |
| Post/message content | Text, links, media | Store text + media metadata (type, size, link); media files are **not** copied | **Not stored** | Default (OD-004) |
| Individual user identities | Sender IDs/usernames of group members, member lists, commenter identities | **Not collected** | **Not collected** | Default |
| Platform user data | Account email, password hash, sessions, billing, API keys | Own users only, per SECURITY.md / API-SECURITY.md | — | Required by spec |

Rationale for group defaults: public group messages are authored by individuals, so storing them or their senders would amount to profiling individual users, a PRD non-goal. The owner may expand this via OD-004, and must record a lawful basis first.

## 5. Retention

| Data | Retention |
|---|---|
| Historical metric snapshots | Kept indefinitely unless OD-004 sets a limit; append-only. |
| Post content (channels) | TBD (OD-004). |
| Raw provider responses (debug) | Not retained beyond job processing unless OD-004 sets a window. |
| Platform user accounts | Until account deletion + TBD grace period (OD-004). |
| Backups | 7 daily / 4 weekly / 3 monthly (BACKUPS.md). |
| Audit logs | TBD (OD-004); never editable by the actor. |

## 6. Status changes and removal

- Entity becomes private, deleted or inaccessible → mark status, stop collection, keep past public observations, stop showing it as live. Public display of past data for such entities is TBD (OD-004).
- Owner removal/opt-out request → moderator workflow (FR-MOD-01). Whether this hides or deletes data, and how it interacts with principle 5, is TBD (OD-004).
- Legal takedown → handled per jurisdiction (OD-004).

## 7. Security and access

- Telegram credentials (bot token, `api_id`/`api_hash`, session files) and all other secrets live in a secret store, never in the repo, logs or `.env` files committed to git (CLAUDE.md, OBSERVABILITY.md).
- No raw API-key or payment secrets stored (CLAUDE.md, API-SECURITY.md).
- Least-privilege access to databases; PostgreSQL/Redis never exposed publicly (DEPLOYMENT.md).

## 8. Open items

Jurisdiction, lawful basis, privacy policy/terms content, retention periods and removal semantics: OD-004. The policy cannot be finalized for production (PHASE-31) until OD-004 is resolved.
