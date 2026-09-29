# Phase Plan Proposal

Status: **Proposal (OD-011)**. No phase file has been changed. Written after PHASE-00 from an audit of `docs/phases/PHASE-00..37.md` against the rest of the spec.

## 1. Findings

### F1 — Required References are wrong or missing in several phases

Evidence: the `## Required References` section of each phase file.

| Phase | Currently references | Expected (based on topic) |
|---|---|---|
| 02 Repository Bootstrap | none | `operations/TESTING.md`, `operations/DEPLOYMENT.md` (Docker), `adr/ADR-001` |
| 03 Environment Management | none | `security/SECURITY.md` (secret management), `operations/DEPLOYMENT.md` |
| 16 Authentication | none | `security/SECURITY.md`, `security/ASVS-CHECKLIST.md` |
| 17 RBAC | none | `security/SECURITY.md`, `security/ASVS-CHECKLIST.md`, `database/POSTGRESQL.md` |
| 24 Billing | `operations/DEPLOYMENT.md` | `security/SECURITY.md` (webhook spoofing, payment fraud), `database/POSTGRESQL.md` |
| 30 Staging | `operations/TESTING.md` | `operations/DEPLOYMENT.md`, `operations/TESTING.md` |
| 31 Production | `operations/DEPLOYMENT.md` | `operations/DEPLOYMENT.md`, `operations/BACKUPS.md`, `operations/OBSERVABILITY.md` |
| 32 Load Testing | `operations/DEPLOYMENT.md`, `operations/BACKUPS.md` | `operations/TESTING.md` |
| 34 Disaster Recovery | `operations/TESTING.md` | `operations/BACKUPS.md` |
| 35 Performance Optimization | `operations/BACKUPS.md` | `operations/OBSERVABILITY.md`, `operations/TESTING.md` |
| 36 Production Launch | `operations/TESTING.md` | `operations/PRODUCTION-READINESS.md`, `operations/RELEASE-CHECKLIST.md` |

Other gaps: no phase references `PRODUCTION-READINESS.md`, `CLAUDE-PHASE-RUNNER.md`, the ADRs or `product/DATA-POLICY.md`. Phases 30–36 look shifted by one phase.

### F2 — Phase bodies are identical boilerplate

All 38 files share the same Implementation, Security, Performance, Failure and Acceptance sections; only Objective, Scope and References differ. Only PHASE-00 has a phase-specific acceptance matrix, so later gates are not independently testable.

### F3 — Quality gates arrive late

CI/CD is PHASE-29, observability PHASE-27 and staging PHASE-30. That leaves phases 02–28 without automated gates, even though CLAUDE.md requires lint/typecheck/test/build at every phase and staging verification for production changes.

### F4 — Telegram risk is not retired early

D-001 adds MTProto, which needs accounts (OD-003) and Terms of Service compliance. PHASE-06 builds the adapter without a prior step that verifies which fields the Bot API and MTProto actually expose for public channels and groups (CLAUDE.md: "never invent … unsupported API capabilities").

### F5 — The threat model comes after most attack surface exists

`THREAT-MODEL.md` is first referenced in PHASE-28. By then auth, RBAC, API keys, billing and the bot (phases 16–26) are built.

### F6 — Exports have no owning phase

`workers/exports` and the `exports.generate` queue exist, but no phase's scope mentions exports (FR-EXP-01 is mapped to 18/25 provisionally).

### F7 — No early end-to-end proof

The first user-visible output is PHASE-13, after seven back-end phases. Integration problems between ingestion, storage and reads surface late.

## 2. Proposed changes

These changes keep the existing numbering. New steps use letter suffixes so existing references stay valid.

| # | Change | Fixes |
|---|---|---|
| P1 | Correct the Required References per the F1 table, and add `DATA-POLICY.md` to phases 06, 07, 08 and 10. | F1 |
| P2 | At the start of each phase, write `PHASE-XX-ACCEPTANCE.md` with phase-specific, testable criteria and get owner approval (D-008) before implementation. | F2 |
| P3 | Extend PHASE-02 scope with a minimal CI pipeline (lint, typecheck, unit tests, build, secret scan, dependency audit) and PHASE-29 then adds container, staging and release gates. | F3 |
| P4 | Extend PHASE-02/08 with a minimal structured logger and health endpoint; PHASE-27 completes metrics, tracing and error tracking. | F3 |
| P5 | Add **PHASE-05A — Telegram Feasibility Spike**: verify, from official Telegram documentation and a sandboxed test account, which fields each interface returns for public channels and groups; record ToS constraints and the MTProto account plan (resolves OD-003); publish a capability matrix used by PHASE-06. | F4 |
| P6 | Extend PHASE-01 scope with an initial threat model (`THREAT-MODEL.md` format); PHASE-28 then reviews and extends it. | F5 |
| P7 | Add exports explicitly to PHASE-18 scope (request + list) with the worker implemented under PHASE-08 conventions. | F6 |
| P8 | Add **PHASE-11A — Vertical Slice**: one public channel from discovery → snapshot → metric → minimal read endpoint → minimal page, behind a feature flag, before public web/search breadth. | F7 |
| P9 | Move a minimal staging environment to right after P8 (**PHASE-11B**), so collection against real Telegram runs in staging before production (CLAUDE.md). PHASE-30 hardens and seeds it. | F3 |

## 3. Resulting order (proposed)

00 → 01 (+threat model) → 02 (+CI, logger) → 03 → 04 → 05 → **05A feasibility** → 06 → 07 → 08 → 09 → 10 → 11 → **11A vertical slice** → **11B minimal staging** → 12 … 37 (unchanged order, corrected references).

## 4. If adopted

1. Record D-0xx accepting all or part of this proposal.
2. Edit only the `Scope` and `Required References` sections of the affected phase files; create PHASE-05A, 11A and 11B from the existing template.
3. Remove this proposal's "Proposal" status and link it from `README.md`.
