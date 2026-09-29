# TG Analytics — Claude Code Engineering Specification

Source-of-truth engineering specification for a production-grade Telegram public channel and group analytics, discovery, monitoring, API and bot platform.

## Execution
1. Read `CLAUDE.md`.
2. Read the requested `docs/phases/PHASE-XX.md`.
3. Read referenced architecture/security/database documents.
4. Inspect the repository.
5. Implement only the requested phase.
6. Run verification.
7. Update documentation.
8. Never claim completion without evidence.

PHASE-00 through PHASE-37 (plus PHASE-05A, 11A, 11B) are sequential gates. Order and rationale: `docs/phases/PHASE-PLAN-PROPOSAL.md`.

Core principle:
Telegram supported interfaces -> ingestion workers -> durable queues -> normalized storage -> analytics -> search/API/cache -> web/dashboard/bot.

## Development

Requires Node.js 24 (`.node-version`), pnpm 11 (`corepack enable`) and Docker.

```sh
pnpm install --frozen-lockfile
cp .env.example .env        # local only; git-ignored
pnpm run ci                 # lint, typecheck, boundaries, build, test, audit
docker compose up --build   # api on 127.0.0.1:3001, web on 127.0.0.1:3000
```

Tooling decisions: `docs/adr/ADR-008-workspace-tooling.md`. Import rules: `scripts/boundaries.rules.mjs` (mirrors `docs/architecture/SERVICE-BOUNDARIES.md` §4).

### Vertical slice (local)

```sh
pnpm --filter @tga/worker-discovery discover:local https://t.me/<public_channel> --actor <you>
pnpm --filter @tga/worker-scheduler flags:local set slice.channel-page on --actor <you>
docker compose up --build        # then open http://127.0.0.1:3000/channel/<username>
```

Run the discovery, metadata and metrics workers (`start:local`) to collect data. Details: `docs/phases/PHASE-11A-ACCEPTANCE.md`.

### Staging (host-agnostic)

```sh
node scripts/staging/init-secrets.mjs                        # git-ignored staging/secrets/
docker compose -f docker-compose.staging.yml up -d --build   # proxy on 127.0.0.1:8080
node scripts/staging/smoke.mjs http://127.0.0.1:8080
```

Runbook: `docs/operations/STAGING.md`. Remote host and edge: OD-016.
