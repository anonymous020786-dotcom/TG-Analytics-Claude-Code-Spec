# apps/api

NestJS API and application/domain orchestration.

Current state (PHASE-02): process skeleton with `GET /health/live` and structured logging. Configuration is validated at startup (`src/config.ts`, `docs/operations/CONFIGURATION.md`). Readiness checks arrive with dependencies (PHASE-04+, PHASE-27).

```sh
pnpm --filter @tga/api build && pnpm --filter @tga/api start:local   # reads ../../.env if present
```
