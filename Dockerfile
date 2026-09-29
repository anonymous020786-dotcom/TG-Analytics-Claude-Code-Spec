# syntax=docker/dockerfile:1
# Multi-stage build for the TG Analytics workspace. Targets: api, web.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Manifests only, so dependency layers cache independently of source changes.
# Add every workspace package.json here when a package is created.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/logging/package.json packages/logging/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/types/package.json packages/types/
COPY packages/adapter-telegram/package.json packages/adapter-telegram/
COPY packages/validation/package.json packages/validation/
COPY workers/discovery/package.json workers/discovery/
COPY packages/queues/package.json packages/queues/
COPY packages/analytics/package.json packages/analytics/
COPY workers/metrics/package.json workers/metrics/
COPY workers/metadata/package.json workers/metadata/
COPY workers/scheduler/package.json workers/scheduler/
COPY workers/ranking/package.json workers/ranking/

FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter "@tga/api..." --filter "@tga/web" build

FROM manifests AS api-deps
RUN pnpm install --frozen-lockfile --prod --filter "@tga/api..."

# Assemble production-only node_modules plus every workspace package's built dist/ (no sources,
# no dev dependencies). Robust to new internal dependencies.
FROM api-deps AS api-assemble
COPY --from=build /repo/packages /tmp/packages
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
RUN for d in /tmp/packages/*/; do n=$(basename "$d"); if [ -d "$d/dist" ] && [ -d "/repo/packages/$n" ]; then cp -r "$d/dist" "/repo/packages/$n/"; fi; done && rm -rf /tmp/packages

FROM node:24-alpine AS api
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=api-assemble --chown=node:node /repo /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

FROM node:24-alpine AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
