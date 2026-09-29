# Staging Runbook (PHASE-11B)

Minimal, isolated staging running the vertical slice: `docker-compose.staging.yml`. It's host-agnostic (any Docker host); the concrete host, domain, TLS and secret store are **OD-016**. PHASE-30 hardens and seeds it.

## Topology

```text
Internet ─TLS─> [host TLS terminator / Cloudflare Tunnel] ─> proxy:8080 (nginx, non-root)
proxy ── app network (internal) ──> web:3000, api:3001
api, workers ── data network (internal, no internet) ──> postgres, redis
worker-discovery/metadata/metrics ── egress network ──> api.telegram.org
```

- Datastores have **no published ports and no internet access** (DEPLOYMENT.md).
- Only the proxy publishes a port, bound to `127.0.0.1:8080` by default (`STAGING_BIND`, `STAGING_HTTP_PORT`).
- The proxy adds security headers, `X-Robots-Tag: noindex`, and a `robots.txt` that disallows everything. It propagates `X-Request-Id`, writes JSON access logs, and applies per-IP rate limits (API 10 r/s, pages 20 r/s; provisional).
- App containers are read-only, drop all capabilities, run as non-root and cannot escalate privileges.

## Secrets

- Secrets are Docker secrets read from `staging/secrets/*` (git-ignored). Apps read them via `*_FILE` (ADR-009), and `APP_ENV=staging` rejects placeholder values.
- `node scripts/staging/init-secrets.mjs` creates the Postgres and Redis passwords, the connection URLs, and the bot token (from `STAGING_TELEGRAM_BOT_TOKEN`). It never prints values.
- Staging should use **its own** bot token (D-015). Moving from files to a managed secret store is part of OD-016.

## Deploy

```sh
node scripts/staging/init-secrets.mjs
docker compose -f docker-compose.staging.yml up -d --build   # runs `migrate` once before api/workers
docker compose -f docker-compose.staging.yml ps
```

## Seed the allow-listed channels and enable the slice

Discovery only accepts `DISCOVERY_ALLOWLIST` (default `telegram,durov,bottalk`; override with `STAGING_ALLOWLIST`).

```sh
S="docker compose -f docker-compose.staging.yml exec"
$S worker-discovery node workers/discovery/dist/discover-cli.js telegram --actor <you>
$S worker-scheduler node workers/scheduler/dist/flags-cli.js set slice.channel-page on --actor <you>
$S worker-scheduler node workers/scheduler/dist/flags-cli.js set search.public on --actor <you>   # PHASE-12
```

## Verify

```sh
node scripts/staging/smoke.mjs http://127.0.0.1:8080 --channel telegram
```

If port 8080 is taken on the host, set `STAGING_HTTP_PORT` (e.g. `8088`) for both `up` and the smoke URL.

Also check:

- **Collection status:** the API response (`quality.verdict`, freshness, failure class); dead letters via `$S worker-scheduler node workers/scheduler/dist/redrive-cli.js list`.
- **Rate limiting (Telegram):** during and shortly after a Telegram call, the shared limiter key `tga-staging:ratelimit:bot_api:staging-bot` exists in Redis with a TTL (it expires when idle, by design). Every worker uses the same key.
- **No datastore exposure:** `docker compose -f docker-compose.staging.yml port postgres 5432` must print nothing.

## Rollback

- **Application:** redeploy the previous git tag (`git checkout <tag> && docker compose ... up -d --build`). Migrations are additive (expand/contract), so older code runs against the newer schema.
- **Data:** staging data is disposable. `docker compose -f docker-compose.staging.yml down -v` destroys it; that's a destructive operation and needs explicit approval.

## Rotate secrets

1. `node scripts/staging/init-secrets.mjs --rotate`
2. Update the database role password to match: `ALTER ROLE tga PASSWORD ...`, via `psql` in the postgres container.
3. `docker compose -f docker-compose.staging.yml up -d --force-recreate`
