# The API, built from the workspace root.
#
#   docker build -f apps/api/Dockerfile -t proofforge-api .
#
# Context is the repository root, not this directory: the API depends on seven
# workspace packages, and a context rooted here could not see any of them.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

# Dependencies resolve from the manifests alone, so this layer survives every
# change that does not touch a package.json or the lockfile — which is most of them.
FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/agents/package.json packages/agents/
COPY packages/ai-providers/package.json packages/ai-providers/
COPY packages/database/package.json packages/database/
COPY packages/evidence-spec/package.json packages/evidence-spec/
COPY packages/github/package.json packages/github/
COPY packages/observability/package.json packages/observability/
COPY packages/policy-engine/package.json packages/policy-engine/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --filter @proofforge/api...

FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json turbo.json ./
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @proofforge/api... build
# Drop dev dependencies before they are copied into the final image.
RUN pnpm prune --prod

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Unprivileged, and with the same uid the evidence sandbox uses. Nothing here
# needs root, and an image that runs as root is one CVE away from mattering.
RUN addgroup -g 10001 -S runner && adduser -u 10001 -S runner -G runner

COPY --from=build --chown=runner:runner /repo/node_modules ./node_modules
COPY --from=build --chown=runner:runner /repo/packages ./packages
COPY --from=build --chown=runner:runner /repo/apps/api ./apps/api

USER runner
EXPOSE 3001

# The container's own liveness signal, so an orchestrator restarts a wedged
# process instead of leaving it in the load balancer answering nothing.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
