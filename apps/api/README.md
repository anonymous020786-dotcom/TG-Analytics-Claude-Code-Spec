# apps/api

NestJS API and application/domain orchestration.

Current state (PHASE-11A): `GET /health/live` and the flag-gated `GET /api/v1/channels/:username` (read model over stored snapshots; never calls Telegram). Configuration is validated at startup (`src/config.ts`, `docs/operations/CONFIGURATION.md`). Readiness checks arrive with dependencies (PHASE-04+, PHASE-27).

```sh
pnpm --filter @tga/api build && pnpm --filter @tga/api start:local   # reads ../../.env if present
```
