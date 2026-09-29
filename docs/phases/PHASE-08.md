# PHASE-08 — Ingestion

## Objective
Build durable post/metric collectors, queues, persistence and idempotency.

## Prerequisites
Phase 07 must pass its acceptance gate.

## Problem Statement
Without this phase, the platform carries a specific correctness, security, scalability or operational risk. Implement the smallest production-safe solution that removes that risk.

## Scope
Implement specialized collectors, durable jobs, persistence and worker lifecycle.

## Out of Scope
- Future phases.
- Unrequested provider-specific capabilities.
- Destructive production changes without explicit approval.

## Required References
- `docs/architecture/QUEUE-ARCHITECTURE.md`
- `docs/adr/ADR-006-queue-transport-and-job-ledger.md`
- `docs/product/DATA-POLICY.md`

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
- Duplicate/retry/failure scenarios preserve correctness and do not silently lose jobs.

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
