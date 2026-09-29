# TG Analytics — Claude Code Engineering Specification

Source-of-truth engineering specification for a production-grade Telegram public channel and group analytics, discovery, monitoring, API and bot platform.

## Execution
1. Read `CLAUDE.md`.
2. Read the requested `docs/phases/PHASE-XX.md`.
3. Read referenced architecture/security/database documents.
4. Inspect the repository.
5. Implement only the requested phase.
6. Run verification.
7. Update documentation.
8. Never claim completion without evidence.

PHASE-00 through PHASE-37 (plus PHASE-05A, 11A, 11B) are sequential gates. Order and rationale: `docs/phases/PHASE-PLAN-PROPOSAL.md`.

Core principle:
Telegram supported interfaces -> ingestion workers -> durable queues -> normalized storage -> analytics -> search/API/cache -> web/dashboard/bot.
