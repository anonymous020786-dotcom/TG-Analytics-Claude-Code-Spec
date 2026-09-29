# Phase 04 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Core tables | Catalog, job ledger and administration tables per D-013 | Migration `init_core_schema` (12 tables) |
| Constraints | FKs, unique keys, CHECKs for statuses, bounds, formats, failure classes | 33 CHECK constraints; `test/constraints.test.ts` |
| Bounded retries | `max_attempts >= 1`, `attempt <= max_attempts` enforced in the database | `JobRepository` tests |
| Idempotency | Duplicate `(queue, idempotency_key)` returns the existing job | `JobRepository` tests |
| Audit immutability | UPDATE/DELETE/TRUNCATE rejected | `AuditLogRepository` tests |
| Indexes | Every FK indexed; keyset index for posts | Migration SQL review |
| Pagination | Cursor pagination, capped page size, tampered cursors rejected | `pagination.test.ts`, repository walk tests |
| Migration tooling | create-only → review → deploy; drift check in CI; rollback.sql | `pnpm db:check`; planted drift detected (exit 2) |
| Test safety | Harness refuses databases not ending in `_test` | Verified against `tga`: refused, data intact |
| Boundaries | Only `packages/database` imports database drivers | `check-boundaries.test.mjs` (12) |
| Supply chain | Release-age, trust and exotic-dependency policies; audit clean | `pnpm-workspace.yaml`; `pnpm audit`: no known vulnerabilities |
| Scope | No discovery logic, no API database usage, no later-phase tables | Diff review |
