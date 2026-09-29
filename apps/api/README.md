# apps/api

NestJS API and application/domain orchestration.

Current state (PHASE-02): process skeleton with `GET /health/live` and structured logging. Readiness checks arrive with dependencies (PHASE-04+, PHASE-27); typed configuration in PHASE-03.

```sh
pnpm --filter @tga/api build && pnpm --filter @tga/api start   # PORT defaults to 3001
```
