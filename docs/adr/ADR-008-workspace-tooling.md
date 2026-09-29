# ADR-008 — Workspace Tooling Baseline

Status: Accepted (PHASE-02, 2026-09-29; reversible by a later ADR)

## Context

PHASE-02 must create a reproducible monorepo, test harness, Docker environment and CI. The spec already fixes Next.js (`apps/web`), NestJS (`apps/api`), Docker, PostgreSQL and Redis. The remaining tool choices are conventional defaults.

## Decision

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 (`.node-version`) | Current LTS line; used in CI and Docker. |
| Package manager | pnpm 11 workspaces (`packageManager` pinned) | `--frozen-lockfile` everywhere. |
| Language | TypeScript `~6.0`, strict (`tsconfig.base.json`) | TypeScript 7 is released, but typescript-eslint supports `<6.1`; upgrade when the lint toolchain supports 7. |
| Module format | CommonJS output for Node packages; Next.js uses its bundler | Shared packages expose a `source` export condition so tests and typechecks read TypeScript source directly. |
| Lint | ESLint flat config + typescript-eslint | Bans `console`, `eval`, `any`. |
| Tests | Vitest | Per-package `vitest run`; root runs `scripts/` tests. |
| Logging | pino via `@tga/logging` | JSON, ISO time, secret redaction. |
| Import rules | `scripts/check-boundaries.mjs` | Enforces SERVICE-BOUNDARIES.md §4; rules in `scripts/boundaries.rules.mjs`. |
| Containers | One multi-stage `Dockerfile` (targets `api`, `web`), `node:24-alpine`, non-root, read-only in compose | Next.js `standalone` output. |
| CI | GitHub Actions, actions pinned to commit SHAs | gitleaks v8.30.1 (Docker) on full history; `pnpm audit --audit-level high`. |

## Consequences

- Adding a workspace package requires adding its `package.json` COPY line in the Dockerfile `manifests` stage and, for libraries, a rule in `boundaries.rules.mjs`. The checker fails on unknown libraries.
- Container base images are pinned by tag, not digest. Digest pinning and image scanning belong to PHASE-29.
- Queue library selection (ADR-006) is deferred to PHASE-08, when queues are first used.
