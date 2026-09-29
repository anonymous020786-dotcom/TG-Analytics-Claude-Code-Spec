# Configuration

Status: PHASE-03 baseline. Mechanism: `@tga/config` (ADR-009).

## Environments

| `APP_ENV` | Where | Config source | Placeholder secrets |
|---|---|---|---|
| `local` (default) | Developer machine | `.env` (git-ignored), copied from `.env.example` | Allowed |
| `development` | Shared dev environment | Secret store / deployment env | Rejected |
| `staging` | Staging (PHASE-11B, PHASE-30) | Secret store | Rejected |
| `production` | Production (PHASE-31) | Secret store | Rejected |

`NODE_ENV` only selects build/runtime optimizations (`production` in container images). It does not identify the deployment environment.

## Rules

1. Each process declares its variables in a schema (`apps/*/src/config.ts`), and only declared variables are read.
2. Invalid configuration fails at startup with every problem listed; the process exits with code 1.
3. Configuration objects are frozen after load.
4. Secrets are declared in `secrets`. They are:
   - never included in errors or logs (`redactConfig` for startup logs);
   - optionally read from `<NAME>_FILE` (setting both forms is an error);
   - rejected outside `local` if they look like placeholders (`changeme`, `placeholder`, `example`, `secret`, `password`, `todo`, `xxx`).
5. `.env` files are for `local` only and are git-ignored; `.env.example` holds no secrets. A test keeps `.env.example` in sync with every schema.
6. Every phase that adds a variable updates its schema, `.env.example` and the table below together.

## Variables

| Variable | Used by | Type / values | Default | Secret | Since |
|---|---|---|---|---|---|
| `APP_ENV` | all processes | `local` \| `development` \| `staging` \| `production` | `local` | no | PHASE-03 |
| `PORT` | api | integer 1–65535 | `3001` | no | PHASE-02 |
| `LOG_LEVEL` | api | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | `info` | no | PHASE-03 |

## Local usage

```sh
cp .env.example .env
pnpm --filter @tga/api build && pnpm --filter @tga/api start:local   # loads ../../.env via --env-file-if-exists
```
