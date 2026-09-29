# PHASE-02 — Repository Bootstrap

## Objective
Create a reproducible monorepo, tooling, tests, Docker development environment and CI foundation.

## Prerequisites
Phase 01 must pass its acceptance gate.

## Problem Statement
Without this phase, the platform carries a specific correctness, security, scalability or operational risk. Implement the smallest production-safe solution that removes that risk.

## Scope
Create workspace structure, shared configs, test harness, Docker and CI.
Include a minimal CI pipeline (lint, typecheck, unit tests, build, secret scan, dependency audit), a minimal structured logger, a health endpoint and an automated import-boundary check per `SERVICE-BOUNDARIES.md` §4 (P3, P4).

## Out of Scope
- Future phases.
- Unrequested provider-specific capabilities.
- Destructive production changes without explicit approval.

## Required References
- `CLAUDE.md`
- `docs/operations/TESTING.md`
- `docs/operations/DEPLOYMENT.md`
- `docs/adr/ADR-001-modular-monolith.md`
- `docs/architecture/SERVICE-BOUNDARIES.md`

## Implementation Steps
1. Read `CLAUDE.md` and the required references.
2. Inspect the repository and identify existing implementation.
3. Produce a short impact/risk plan before edits.
4. Implement the scope using existing abstractions where possible.
5. Add/update tests for normal, failure, duplicate and authorization paths.
6. Run verification commands.
7. Fix failures.
8. Update docs/ADRs/migrations as applicable.
9. Review the diff for accidental future-phase work.

## Security Requirements
- Validate untrusted input.
- Enforce server-side authorization.
- Protect secrets.
- Add rate limits/abuse controls where applicable.
- Audit sensitive operations where applicable.

## Performance Requirements
- No unbounded queries or payloads.
- Paginate large collections.
- Use asynchronous processing for expensive work.
- Avoid N+1 queries.
- Measure before claiming performance.

## Failure Scenarios
- Dependency unavailable.
- Timeout.
- Invalid input.
- Duplicate request/job.
- Partial failure.
- Authorization failure.
- Retry exhaustion.
- Stale or missing data where applicable.

## Rollback / Recovery
Document application rollback and data recovery. Use expand/migrate/contract for breaking database changes.

## Acceptance Criteria
- Scope is implemented without unapproved future-phase functionality.
- Relevant unit/integration/E2E tests pass.
- Lint, typecheck and production build pass.
- Security requirements for this phase are verified.
- Documentation is updated and no secrets are committed.

## Definition of Done
- [ ] Scope complete.
- [ ] Tests pass.
- [ ] Lint/typecheck/build pass.
- [ ] Security checks pass.
- [ ] Documentation updated.
- [ ] No secrets committed.
- [ ] Acceptance criteria verified.
- [ ] No unapproved future-phase work.

## Claude Execution Instruction
Read `CLAUDE.md` and this phase file. Inspect before modifying. Implement only this phase. Verify every change. Fix failures. Update documentation. Report changed files, tests, security checks, known limitations and next-phase dependencies.
