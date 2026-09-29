# Phase 11B Acceptance Matrix — Minimal Staging

Verified locally on 2026-09-29 with the host-agnostic stack (`docker-compose.staging.yml`, project `tga-staging`, proxy on `127.0.0.1:8088` because 8080 was taken). The remote host, domain, TLS and managed secret store are OD-016.

| Area | Required | Evidence |
|---|---|---|
| Isolation | Separate project, networks, volumes, queue prefix and credential id from dev | Project `tga-staging`; `QUEUE_PREFIX=tga-staging`; `TELEGRAM_CREDENTIAL_ID=staging-bot`; `APP_ENV=staging` |
| Private datastores | PostgreSQL and Redis unreachable from host and internet | `docker compose port postgres 5432` / `port redis 6379` print nothing; both only on the internal `data` network |
| Secrets | Delivered from a secret store; never in git, images or logs | Docker secrets under git-ignored `staging/secrets/` (mode 600) read via `*_FILE`; startup logs show `[REDACTED]`; placeholder values rejected in staging; gitleaks clean |
| Migrations | Applied before apps start | One-shot `migrate` job (`prisma migrate deploy`) completes; API and workers depend on its success |
| Allow-listed collection | Only a small allow-listed set of public entities | `DISCOVERY_ALLOWLIST=telegram,durov,bottalk`; `telegram` → `indexed`, `bbcnews` → `rejected` before any Telegram call (unit test + live) |
| Real Telegram collection | Discovery → metadata → metrics against the real Bot API | `telegram` channel `collection_status=ok`, members 9,441,662, one `members` snapshot |
| Rate limiting | Shared limiter across workers | Key `tga-staging:ratelimit:bot_api:staging-bot` present with TTL during live calls (expires when idle, by design) |
| Collection status | Visible per channel | `collection_status`, `last_collection_error_class`, API `quality.verdict` and freshness |
| Edge | Single entry point with security headers, noindex, request IDs, rate limits | Smoke: 8/8 PASS (health, headers + no server version, request id, robots.txt, real 404 API/page, 400 on invalid username, channel API fields, page with disclaimer) |
| Hardening | Non-root, read-only, no capabilities | `read_only`, `cap_drop: ALL`, `no-new-privileges`; images run as `node` / nginx-unprivileged pinned by digest |
| Recovery | Survives host/engine restart | Docker engine restarted mid-verification; stack came back, transient DB errors during startup recovered without intervention |
| Rollback | Documented | `docs/operations/STAGING.md` (redeploy previous tag; data disposable; `down -v` needs approval) |
| Findings | Parallel image builds re-ran the pnpm supply-chain check per stage (registry timeouts) | BuildKit cache mounts; builds now 13–83 s per image |
| Deferred | Remote host/edge/TLS/secret store (OD-016); image slimming (migrate 1.5 GB, others ~0.75 GB) PHASE-29/35; seeding and hardening PHASE-30 | Documented (ADR-014, OPEN-DECISIONS) |
