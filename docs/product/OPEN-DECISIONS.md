# Decisions and Open Decisions

Owner decisions that shape the product boundary. `D-xxx` = decided; `OD-xxx` = open and must be resolved before the phase listed in "Needed by".

## Decided

| ID | Decision | Date | Consequence |
|---|---|---|---|
| D-001 | Telegram access uses **both** the Bot API and the MTProto client API, behind a single adapter. | 2026-09-29 | FR-TG-02; DATA-POLICY §2. Architecture detail recorded as an ADR in PHASE-01. |
| D-002 | Scope is **public channels and public groups/supergroups**. | 2026-09-29 | PRD §3; DATA-POLICY §3–4 (group-specific defaults). |
| D-003 | Repository is version-controlled with git; baseline spec committed on `main`, phase work on `phase-XX/*` branches. | 2026-09-29 | — |

## Open

| ID | Question | Needed by | Current default / impact |
|---|---|---|---|
| OD-001 | `CLAUDE.md` mission and `README.md` still say "public-channel". Update the wording to "public channel and group" to match D-002? | PHASE-01 | Governance files left unchanged pending approval; PRD states the decided scope. |
| OD-002 | MVP: all features through PHASE-35 (spec default), or a narrower subset? | PHASE-01 | All REQUIREMENTS §2 features tagged `R1`. |
| OD-003 | MTProto accounts: who owns them, how many, dedicated numbers, rotation/ban recovery? | PHASE-06 | Required before any MTProto collector runs. |
| OD-004 | Data policy details: jurisdiction and lawful basis; channel post text storage and retention; group data scope; audit-log and deleted-account retention; removal/opt-out semantics vs append-only history; privacy policy/terms. | PHASE-07 (collection), PHASE-31 (production) | Conservative defaults in DATA-POLICY §4–6. |
| OD-005 | Numeric NFR targets: latency p95, max page size, scale (entities, ingest rate), refresh intervals, availability SLO, RPO/RTO, ASVS level, WCAG level, alert thresholds. | Before each verifying phase (see REQUIREMENTS §3) | Marked TBD; not invented. |
| OD-006 | Plans/tiers and their limits (watchlist size, alert count, history depth, API quota, exports). | PHASE-24 | Tiers named only as Free/Registered, Pro/business, API in PRD personas. |
| OD-007 | Payment provider(s). | PHASE-24 | Provider-agnostic abstraction required regardless. |
| OD-008 | SEO indexation threshold (what makes an entity page "meaningful/current enough"). | PHASE-14 | Pages below threshold `noindex`. |
| OD-009 | Who approves phase acceptance gates? | PHASE-00 sign-off | Assumed: repository owner. |
| OD-010 | Phase template asks every phase for tests/lint/build/rate limits. For documentation-only phases (00, 01), record these as N/A with reasons? | PHASE-00 sign-off | Recorded as N/A in the PHASE-00 report. |
