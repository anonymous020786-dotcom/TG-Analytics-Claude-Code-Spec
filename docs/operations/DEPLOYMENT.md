# Deployment

Initial: Cloudflare -> Nginx -> Docker -> web/api/workers -> PostgreSQL/Redis.

Do not expose PostgreSQL/Redis publicly.

Release: feature -> CI -> staging -> smoke tests -> approval -> production -> health -> monitor.

Use expand/migrate/contract for breaking DB changes.
