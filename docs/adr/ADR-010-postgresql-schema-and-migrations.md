# ADR-010 — PostgreSQL Schema, ORM and Migrations

Status: Accepted (PHASE-04, 2026-09-29)

## Context

PHASE-04 requires the transactional schema, migrations, constraints, indexes and repositories (POSTGRESQL.md, ERD.md). ADR-002 makes PostgreSQL the source of truth; CLAUDE.md requires a migration for every database change and parameterized queries.

## Decision

- **PostgreSQL 18** (`postgres:18-alpine` locally and in CI). Primary keys are UUID v7 from the built-in `uuidv7()`, so no extension is needed. All timestamps are `timestamptz`.
- **Prisma 7.9.1** (`prisma-client` generator, CommonJS output, `@prisma/adapter-pg` driver adapter), pinned exactly. 7.10.0 was rejected: the `prisma` CLI 7.10.0 was published **without provenance**, which pnpm's `trustPolicy` flagged as a possible takeover. Revisit when a provenance-signed release at least 7 days old exists.
- **Conventions:**
  - snake_case tables and columns;
  - every foreign key indexed;
  - statuses are strings validated by `CHECK` constraints, not database enums;
  - `created_at`/`updated_at` everywhere except append-only `audit_logs`.
- **Migrations:** generated with `--create-only`, reviewed and hand-extended (constraints, triggers), with `rollback.sql` where needed. CI runs a drift check.
- **Access path:** only `packages/database` may import database drivers (`scripts/boundaries.rules.mjs`); everything else uses its repositories.
- **Supply-chain hardening** (`pnpm-workspace.yaml`):
  - `minimumReleaseAge` of 7 days;
  - `blockExoticSubdeps`;
  - `trustPolicy: no-downgrade`;
  - install scripts allowed only for `prisma` and `@prisma/engines`;
  - overrides for patched `mysql2` and `deepmerge-ts` (transitive dependencies of the Prisma CLI with high-severity advisories).

## Consequences

- Prisma cannot express CHECK constraints or triggers; they live in migration SQL and are covered by integration tests.
- Some dependencies resolve a few days older than the newest release because of `minimumReleaseAge`.
- Tables for later phases are added by those phases (D-013).

## Alternatives considered

- Kysely or plain SQL migrations: more explicit SQL, but no generated types or drift tooling comparable to Prisma's.
- `pg_uuidv7` extension: unnecessary on PostgreSQL 18.
