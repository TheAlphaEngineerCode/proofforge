# The dashboard, built from the workspace root.
#
#   docker build -f apps/web/Dockerfile -t proofforge-web .
#
# Context is the repository root: the app imports @proofforge/shared-types and
# @proofforge/evidence-spec, which live outside this directory.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/evidence-spec/package.json packages/evidence-spec/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --filter @proofforge/web...

FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json turbo.json ./
COPY packages/evidence-spec packages/evidence-spec
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
# The API base URL is read at build time by the client bundle, so it is an
# argument rather than a runtime variable: changing it means a new image.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @proofforge/web... build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 10001 -S runner && adduser -u 10001 -S runner -G runner

# The standalone output already contains the traced dependencies; static assets
# are not traced and have to be copied alongside it.
COPY --from=build --chown=runner:runner /repo/apps/web/.next/standalone ./
COPY --from=build --chown=runner:runner /repo/apps/web/.next/static ./apps/web/.next/static

USER runner
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
