# Decisions and Open Decisions

Owner decisions that shape the product boundary. `D-xxx` = decided; `OD-xxx` = open and must be resolved before the phase listed in "Needed by".

## Decided

| ID | Decision | Date | Consequence |
|---|---|---|---|
| D-001 | Telegram access uses **both** the Bot API and the MTProto client API, behind a single adapter. | 2026-09-29 | FR-TG-02; DATA-POLICY §2. Architecture detail recorded as an ADR in PHASE-01. |
| D-002 | Scope is **public channels and public groups/supergroups**. | 2026-09-29 | PRD §3; DATA-POLICY §3–4 (group-specific defaults). |
| D-003 | Repository is version-controlled with git; baseline spec committed on `main`, phase work on `phase-XX/*` branches. | 2026-09-29 | — |
| D-004 | `CLAUDE.md` mission and `README.md` wording updated to "public channel and group" (was OD-001). | 2026-09-29 | Governance docs consistent with D-002. |
| D-005 | MVP = Release 1 = all features in REQUIREMENTS §2 (spec default: everything gated by PHASE-36). May be narrowed later by a new decision (was OD-002). | 2026-09-29 | All §2 features tagged `R1`. |
| D-006 | Conservative DATA-POLICY defaults (§4–6) are accepted for development and staging (was part of OD-004). | 2026-09-29 | Groups: aggregate-only, no message text, no sender identities, no member lists. Channel media files not copied. |
| D-007 | Numeric NFR targets are set just-in-time, before the phase that verifies each one; none are invented earlier (was OD-005 timing). | 2026-09-29 | OD-005 remains open per target. |
| D-008 | Phase gates are approved by the repository owner (was OD-009). | 2026-09-29 | — |
| D-009 | For documentation-only phases (00, 01), lint/typecheck/build/test gates are recorded as N/A with reasons; documentation checks (traceability, markdown lint, secret scan, scope diff) are used instead (was OD-010). | 2026-09-29 | — |

## Open

| ID | Question | Needed by | Current default / impact |
|---|---|---|---|
| OD-003 | MTProto accounts: who owns them, how many, dedicated numbers, rotation/ban recovery? | PHASE-06 | Required before any MTProto collector runs. |
| OD-004 | Production data policy: jurisdiction and lawful basis; channel post text retention period; audit-log and deleted-account retention; removal/opt-out semantics vs append-only history; privacy policy/terms. | PHASE-07 (collection of real data), PHASE-31 (production) | D-006 defaults apply until resolved. |
| OD-005 | Numeric NFR targets: latency p95, max page size, scale (entities, ingest rate), refresh intervals, availability SLO, RPO/RTO, ASVS level, WCAG level, alert thresholds. | Before each verifying phase (REQUIREMENTS §3) | Marked TBD (D-007). |
| OD-006 | Plans/tiers and their limits (watchlist size, alert count, history depth, API quota, exports). | PHASE-24 | Personas only name Free/Registered, Pro/business, API. |
| OD-007 | Payment provider(s). | PHASE-24 | Provider-agnostic abstraction required regardless. |
| OD-008 | SEO indexation threshold (what makes an entity page "meaningful/current enough"). | PHASE-14 | Pages below threshold `noindex`. |
| OD-011 | Adopt the phase-plan changes in `docs/phases/PHASE-PLAN-PROPOSAL.md`? | PHASE-01 | Proposal only; phase files unchanged. |
