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
| D-010 | Phase-plan proposal adopted in full (was OD-011): references corrected, scopes extended (01, 02, 18, 27, 28, 29, 30), PHASE-05A/11A/11B added. | 2026-09-29 | `docs/phases/PHASE-PLAN-PROPOSAL.md` status Adopted. |
| D-011 | ADR-006 accepted: Redis-backed queue transport plus PostgreSQL job ledger (was OD-012). | 2026-09-29 | Library chosen in PHASE-02/08. |
| D-012 | ADR-007 accepted: admin UI hosted in `apps/web` under `/admin` initially (was OD-013). | 2026-09-29 | `apps/admin` stays a placeholder. |
| D-013 | PHASE-04 creates only tables whose columns the spec defines now: catalog (channels, channel_aliases, categories, channel_categories, posts, post_media), job ledger (jobs, job_attempts, dead_letter_jobs) and administration (audit_logs, system_settings, feature_flags). User, auth, tracking, API-key, billing and bot tables are created by their own phases (16, 17, 19, 20, 21, 23, 24, 25) with their own migrations. | 2026-09-29 | Avoids inventing columns; ADR-010. |
| D-014 | Analytical storage starts on PostgreSQL behind the `AnalyticsStore` interface; ClickHouse only when measurements justify it. `ranking_snapshots` and `analytics_events` are created in PHASE-11, which produces them. | 2026-09-29 | ADR-011. |
| D-015 | This product uses its own dedicated Telegram credentials (bot token, `api_id`/`api_hash`, MTProto account), never shared with other projects. | 2026-09-29 | Spike evidence: a shared token hit `429` on its first call; ToS 2.1 requires an own `api_id`. CAPABILITY-MATRIX §3–4. |
| D-016 | Collected Telegram data is never used to train, fine-tune or develop AI/ML models (API ToS 1.5). | 2026-09-29 | Added to PRD §7 non-goals. |
| D-017 | Analytics engine: pure calculators, registry, methodology versions on every result, immutable ranking runs (ADR-013). `analytics_events` deferred to PHASE-20, which will define it (amends D-014). | 2026-09-29 | ADR-013. |

## Open

| ID | Question | Needed by | Current default / impact |
|---|---|---|---|
| OD-003 | MTProto account plan: a dedicated account owned by the operator (phone number), a dedicated `api_id`/`api_hash` registered for this app (D-015), how a session is created and stored (secret), how many accounts, ban recovery. PHASE-05A confirmed post history and views are MTProto-only and **user-only** (CAPABILITY-MATRIX §1). | PHASE-06 (build against fixtures); live MTProto verification and any MTProto collector (PHASE-08) | Blocks post analytics and verified/scam flags. Bot API covers discovery, metadata and member counts. |
| OD-004 | Production data policy: jurisdiction and lawful basis; channel post text retention period; audit-log and deleted-account retention; removal/opt-out semantics vs append-only history; privacy policy/terms. | PHASE-07 (collection of real data), PHASE-31 (production) | D-006 defaults apply until resolved. |
| OD-005 | Numeric NFR targets: latency p95, max page size, scale (entities, ingest rate), refresh intervals, availability SLO, RPO/RTO, ASVS level, WCAG level, alert thresholds. | Before each verifying phase (REQUIREMENTS §3) | Marked TBD (D-007). |
| OD-006 | Plans/tiers and their limits (watchlist size, alert count, history depth, API quota, exports). | PHASE-24 | Personas only name Free/Registered, Pro/business, API. |
| OD-007 | Payment provider(s). | PHASE-24 | Provider-agnostic abstraction required regardless. |
| OD-008 | SEO indexation threshold (what makes an entity page "meaningful/current enough"). | PHASE-14 | Pages below threshold `noindex`. |
| OD-015 | Approve ranking/trending v1 parameters: eligibility base 1,000 members, current value ≤ 1 day old, 1,000 entries per run, trending weights 0.7 (1 d) / 0.3 (7 d). | PHASE-13 (first public display) | Proposed in RANKINGS.md/TRENDING.md; changes create new methodology versions. |
