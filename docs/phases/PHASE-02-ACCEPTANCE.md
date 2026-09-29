# Phase 02 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Workspace | pnpm workspace installs reproducibly from lockfile | `pnpm install --frozen-lockfile` from a clean tree |
| Shared config | Strict TS base, ESLint flat config, Vitest | `tsconfig.base.json`, `eslint.config.mjs` |
| Logger | Structured JSON with redaction of secrets/auth headers | `packages/logging` tests (4) |
| Health | `GET /health/live` → 200 `{status:"ok"}`, `no-store`, no `X-Powered-By` | `apps/api` tests (3); container healthcheck `healthy` |
| Boundaries | SERVICE-BOUNDARIES §4 enforced; violation fails the build | `scripts/check-boundaries.test.mjs` (11); planted violation exits 1 |
| Docker | api + web images build; non-root; read-only; ports bound to 127.0.0.1 | `docker compose up` verification |
| CI | lint, typecheck, boundaries, build, test, dependency audit, secret scan | `.github/workflows/ci.yml` (actionlint clean); `pnpm run ci` exit 0 locally |
| Secrets | No secrets in history or tracked files | gitleaks `git` scan: no leaks |
| Scope | No config validation (PHASE-03), DB (PHASE-04), workers, or product features | Diff review |
