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

### Database variables (PHASE-04)

These are used by `packages/database` tooling and tests. Application processes add them to their own schemas when they first use the database.

| Variable | Used by | Purpose | Secret |
|---|---|---|---|
| `POSTGRES_PASSWORD` | docker-compose (local) | Local superuser password | yes |
| `DATABASE_URL` | Prisma migrate commands | Target database | yes |
| `SHADOW_DATABASE_URL` | `migrate dev`, `db:check` | Prisma shadow database | yes |
| `TEST_DATABASE_URL` | integration tests | Must end in `_test`; wiped on every run | yes |

### Redis and worker variables (PHASE-08)

| Variable | Used by | Type / values | Default | Secret |
|---|---|---|---|---|
| `REDIS_PASSWORD` | docker-compose (local) | string | — | yes |
| `REDIS_URL` | workers | `redis://:<password>@host:6379/<db>` | — | yes |
| `TEST_REDIS_URL` | queue integration tests | Redis URL; tests use a unique key prefix per run | — | yes |
| `QUEUE_PREFIX` | workers | `[a-z0-9-]{1,32}` | `tga` | no |
| `WORKER_CONCURRENCY` | workers | integer 1–16 | `2` | no |
| `TELEGRAM_BOT_TOKEN` | workers | Bot API token (dedicated, D-015) | — | yes |
| `TELEGRAM_CREDENTIAL_ID` | workers | `[a-z0-9-]{1,32}` | `bot-1` | no |

Workers also read `LOG_LEVEL`, `APP_ENV` and `DATABASE_URL`.

### Scheduler variables (PHASE-09)

| Variable | Type / values | Default | Secret |
|---|---|---|---|
| `SCHEDULER_TICK_SECONDS` | integer 10–3600 | `60` | no |
| `METRICS_REFRESH_MINUTES` | integer 5–10080 (provisional, OD-005) | `360` | no |
| `METADATA_REFRESH_MINUTES` | integer 5–10080 (provisional, OD-005) | `1440` | no |
| `RANKING_REFRESH_MINUTES` | integer 5–10080 (provisional, OD-005) | `60` | no |

The scheduler also reads `DATABASE_URL` and `LOG_LEVEL`.

`workers/ranking` and `workers/search` read `DATABASE_URL`, `REDIS_URL`, `QUEUE_PREFIX`, `WORKER_CONCURRENCY` and `LOG_LEVEL`. They never call Telegram.

### Vertical slice variables (PHASE-11A)

| Variable | Used by | Purpose | Default | Secret |
|---|---|---|---|---|
| `DATABASE_URL` | api | Read model for `/api/v1/channels/:username` | — | yes |
| `METRICS_REFRESH_MINUTES`, `METADATA_REFRESH_MINUTES` | api | Freshness judgement (same values as the scheduler) | `360`, `1440` | no |
| `API_INTERNAL_URL` | web (server only) | API base URL for server-side rendering; never sent to browsers | `http://127.0.0.1:3001` | no |

Feature flag `slice.channel-page` (default off) gates the endpoint and page: `pnpm --filter @tga/worker-scheduler flags:local set slice.channel-page on --actor <operator-id>`.

### Search (PHASE-12)

No new variables. Feature flag `search.public` (default off) gates `GET /api/v1/channels` and `GET /api/v1/search/suggest`: `pnpm --filter @tga/worker-scheduler flags:local set search.public on --actor <operator-id>`. Engine and relevance: ADR-015.

### Public web (PHASE-13)

No new variables. Feature flags:

| Flag | Default | Gates |
|---|---|---|
| `slice.channel-page` | off | `/channel/[username]` and its sub-pages; `GET /api/v1/channels/:username` and `/:id/stats` |
| `search.public` | off | `/search`, `/channels`, home "largest" list; `GET /api/v1/channels`, `/search/suggest` |
| `rankings.public` | off | `/rankings`, `/trending`, their nav links; `GET /api/v1/rankings*`, `/trending`. Parameters approved (D-019): enable when rankings should be public. |

The web app reads the API only server-side (`API_INTERNAL_URL`). Browser autocomplete calls `/api/v1/search/suggest` on the same origin, routed by the edge proxy; without the proxy (plain local dev) suggestions are simply absent.

### SEO (PHASE-14)

| Variable | Used by | Purpose | Default | Secret |
|---|---|---|---|---|
| `SEO_MIN_MEMBERS` | api | Indexation rule: minimum subscribers for an indexable channel page (provisional, OD-008) | `1000` | no |
| `SEO_MIN_HISTORY_DAYS` | api | Indexation rule: minimum days of collected history (provisional, OD-008) | `7` | no |
| `PUBLIC_SITE_URL` | web (server only) | Public origin for canonical URLs, sitemap and Open Graph; `http(s)` origin, no path | `http://127.0.0.1:3000` | no |

Feature flag `seo.indexing` (default off) is the master switch: while off, every page is `noindex`, `robots.txt` disallows everything and the sitemap is empty. The staging edge adds `X-Robots-Tag: noindex` and its own `robots.txt` regardless.

### Accounts (PHASE-16, D-021)

| Variable | Used by | Purpose | Default | Secret |
|---|---|---|---|---|
| `TELEGRAM_LOGIN_BOT_TOKEN` | api | Login bot token (Telegram Login Widget signature key); the bot needs the site domain set with BotFather `/setdomain` | — (sign-in disabled) | yes |
| `TELEGRAM_LOGIN_BOT_USERNAME` | api | Login bot username, shown to the widget | — | no |
| `CSRF_SECRET` | api | HMAC key for CSRF tokens, at least 32 characters | — | yes |
| `PUBLIC_SITE_URL` | api | Exact allowed `Origin` for state-changing requests (same value as the web's) | `http://127.0.0.1:3000` | no |
| `SESSION_ABSOLUTE_DAYS` / `SESSION_IDLE_DAYS` | api | Session lifetimes (provisional, OD-005) | `30` / `7` | no |
| `COOKIE_SECURE` | api | `Secure` + `__Host-` cookies; `false` only for plain-HTTP non-localhost testing | `true` | no |

Sign-in routes exist only when the token, username and CSRF secret are all set. Feature flag `auth.login` (default off) must also be on. Empty values in `.env.example` mean "not configured".

### Staging variables (PHASE-11B)

| Variable | Used by | Purpose | Default | Secret |
|---|---|---|---|---|
| `DISCOVERY_ALLOWLIST` | worker-discovery | Comma-separated usernames; anything else is rejected before any Telegram call. Unset = no allow-list (dev). | unset | no |
| `DATABASE_URL_FILE`, `REDIS_URL_FILE`, `TELEGRAM_BOT_TOKEN_FILE` | api, workers | Read the secret from a file (Docker secret), ADR-009 | — | path only |
| `STAGING_ALLOWLIST` | `docker-compose.staging.yml` | Value passed as `DISCOVERY_ALLOWLIST` | `telegram,durov,bottalk` | no |
| `STAGING_BIND` | `docker-compose.staging.yml` | Host address the proxy binds to | `127.0.0.1` | no |
| `STAGING_HTTP_PORT` | `docker-compose.staging.yml` | Host port for the proxy | `8080` | no |
| `STAGING_TELEGRAM_BOT_TOKEN` | `scripts/staging/init-secrets.mjs` | Dedicated staging bot token written to `staging/secrets/` (falls back to `TELEGRAM_BOT_TOKEN`) | — | yes |

Runbook: `docs/operations/STAGING.md`.
