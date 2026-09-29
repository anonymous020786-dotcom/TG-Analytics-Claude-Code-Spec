# ADR-009 — Typed Configuration and Secret Sourcing

Status: Accepted (PHASE-03, 2026-09-29)

## Context

PHASE-03 requires separate local, development, staging and production configuration with safe secret handling. CLAUDE.md forbids committing secrets or `.env` files. SECURITY.md requires secret management, and THREAT-MODEL T12 covers secret leakage through the repo, logs and images.

## Decision

- `APP_ENV` (`local` | `development` | `staging` | `production`) identifies the deployment environment, separate from `NODE_ENV`.
- Each process validates its environment at startup with a zod schema through `@tga/config` and fails fast on any problem.
- Secrets are declared per schema. They can be injected directly or through `<NAME>_FILE`, are never echoed or logged, and placeholder values are rejected outside `local`.
- `.env` files are used only locally, loaded with Node's `--env-file-if-exists`. No dotenv dependency and no `.env` loading in application code.
- Variables are added by the phase that first consumes them. No speculative variables.

## Consequences

- Misconfiguration surfaces at deploy time rather than at first use.
- Container images contain no configuration; staging and production must provide every required variable.
- The choice of secret store (e.g. a platform secret manager) is made with deployment in PHASE-11B/31; it only has to expose environment variables or files.

## Alternatives considered

- dotenv loading inside the app: risks loading `.env` in production by accident.
- A config file per environment in the repo: invites committed secrets.
