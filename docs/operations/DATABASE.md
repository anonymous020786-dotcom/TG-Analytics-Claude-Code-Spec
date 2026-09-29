# Database Operations

Status: PHASE-04 baseline. Decisions: ADR-002, ADR-010. Schema: `packages/database/prisma/schema.prisma`.

## Local setup

```sh
cp .env.example .env          # set POSTGRES_PASSWORD and the three *_DATABASE_URL values
pnpm db:up                    # PostgreSQL 18 on 127.0.0.1:5432 (creates tga, tga_test, tga_shadow on first start)
pnpm db:migrate               # prisma migrate deploy against DATABASE_URL
```

## Migration workflow

1. Edit `schema.prisma`.
2. `pnpm --filter @tga/database migrate:create --name <change>`. This generates SQL without applying it.
3. Review and hand-edit the SQL: add CHECK constraints, triggers, `CONCURRENTLY` indexes and other things Prisma cannot express.
4. `pnpm --filter @tga/database migrate:dev` applies it locally; run the tests.
5. Add `rollback.sql` next to `migration.sql` for any change that is not trivially reversible.
6. `pnpm db:check` (also in CI) fails if migrations and schema differ. Every schema change needs a migration.
7. Staging and production use `prisma migrate deploy` only, never `migrate dev` (PHASE-11B/31).

## Safety rules

- **Breaking changes use expand, migrate, contract** (DEPLOYMENT.md): add nullable, backfill, then enforce; never drop or rename a column in the same deploy that stops using it.
- **Large tables:** index with `CREATE INDEX CONCURRENTLY` in a migration of its own; add constraints `NOT VALID`, then `VALIDATE` separately.
- **One concern per migration;** schema changes and data backfills are kept apart.
- **History is kept:** `channels` and `posts` use `ON DELETE RESTRICT`, so a channel's history cannot be deleted by accident (CLAUDE.md).
- **Audit is immutable:** `audit_logs` rejects UPDATE, DELETE and TRUNCATE via trigger.
- **Destructive rollbacks** (e.g. `20260929052732_init_core_schema/rollback.sql`) require explicit approval.

## Tests

- Integration tests run against `TEST_DATABASE_URL`. The harness **refuses any database whose name does not end in `_test`**, then drops the `public` schema and applies the real migrations.
- CI provides an ephemeral `postgres:18-alpine` service with trust auth, so no password is in the repo.
- Packages whose tests use the shared `*_test` database (`@tga/database`, `workers/*`) must not run concurrently, so the root `pnpm test` runs packages serially (`--workspace-concurrency=1`). Files within a package already run serially (`fileParallelism: false`).

## Pagination and limits

- Keyset (cursor) pagination only; cursors are opaque, validated and rejected with `InvalidCursorError` when tampered.
- `MAX_PAGE_SIZE` = 100 and the pool/timeout defaults in `DATABASE_DEFAULTS` are **provisional** until OD-005 sets targets.

## Analytical snapshots (PHASE-05)

`channel_metric_snapshots` and `post_metric_snapshots` are append-only (UPDATE blocked by trigger). Access them only through `PostgresAnalyticsStore` (ADR-011). Deleting snapshots is reserved for the retention/removal policy (OD-004) and needs explicit approval.
