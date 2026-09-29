# Phase 03 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Environments | local/development/staging/production separated via `APP_ENV` | `@tga/config`; CONFIGURATION.md |
| Typed validation | Declared keys only, coercion, defaults, all issues reported, frozen result | `packages/config` tests (11) |
| Fail fast | Invalid config exits 1 with structured error | Smoke: `APP_ENV=prod PORT=abc` → fatal log, exit 1 |
| Secret handling | Never echoed/logged; `*_FILE`; placeholders rejected outside local | `packages/config` tests; `redactConfig` |
| `.env.example` | Safe, complete, validated by tests | `apps/api/src/config.test.ts` (5) |
| Local `.env` | Git-ignored; loaded only by `start:local` | `git check-ignore .env`; smoke on port 3913 |
| Boundaries | New `config` library registered in rules and SERVICE-BOUNDARIES §4 | `pnpm check:boundaries` |
| Scope | No database, queues or product features | Diff review |
