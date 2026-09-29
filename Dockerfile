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
COPY workers/metrics/package.json workers/metrics/
COPY workers/metadata/package.json workers/metadata/

FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter "@tga/api..." --filter "@tga/web" build

FROM manifests AS api-deps
RUN pnpm install --frozen-lockfile --prod --filter "@tga/api..."

FROM node:24-alpine AS api
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=api-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=api-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-deps --chown=node:node /repo/packages/logging/node_modules ./packages/logging/node_modules
COPY --from=api-deps --chown=node:node /repo/packages/config/node_modules ./packages/config/node_modules
COPY --from=build --chown=node:node /repo/packages/logging/package.json ./packages/logging/
COPY --from=build --chown=node:node /repo/packages/logging/dist ./packages/logging/dist
COPY --from=build --chown=node:node /repo/packages/config/package.json ./packages/config/
COPY --from=build --chown=node:node /repo/packages/config/dist ./packages/config/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
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
