# ProofForge API

Fastify + TypeScript REST API for ProofForge. Backs the dashboard: authentication,
organizations, repositories, analyses (with a live event stream), evidence bundles and
policies.

## Storage

The API talks to a `Storage` interface (`@proofforge/database`). It uses the **in-memory
backend** by default (local development and tests — no database needed) and the
**PostgreSQL backend** when `DATABASE_URL` is set. Both satisfy the same contract, so the
routes never change.

## Run

```bash
pnpm --filter @proofforge/api dev      # tsx watch, in-memory storage
pnpm --filter @proofforge/api build && pnpm --filter @proofforge/api start
```

Local auth: with `AUTH_DEV_LOGIN=true` (default in dev), `POST /api/v1/auth/dev-login`
returns a bearer token. GitHub OAuth issues the same session tokens in Phase 5.

## Endpoints

```
GET    /health
GET    /ready
POST   /api/v1/auth/dev-login        (dev only)
GET    /api/v1/me
GET    /api/v1/organizations
POST   /api/v1/organizations
GET    /api/v1/repositories?organizationId=...
POST   /api/v1/repositories
GET    /api/v1/repositories/:id
GET    /api/v1/repositories/:id/analyses
POST   /api/v1/repositories/:id/analyze
GET    /api/v1/analyses/:id
GET    /api/v1/analyses/:id/events    (Server-Sent Events)
GET    /api/v1/evidence-bundles/:id
GET    /api/v1/evidence-bundles/:id/manifest
GET    /api/v1/policies?organizationId=...
POST   /api/v1/policies
POST   /api/v1/policies/:id/validate
```

## The analysis pipeline

`POST /repositories/:id/analyze` creates an analysis and starts the in-process runner, which
walks the [state machine](../../packages/shared-types/src/states.ts) — persisting each
transition and publishing events consumed by the SSE stream. At `EVIDENCE_GENERATION` it
builds a real, schema-valid `proof-manifest.json` (via `@proofforge/evidence-spec`, the same
hashing as the CLI and Python engine) and stores an evidence bundle.

The pipeline's evidence values are placeholders for now; wiring the Python evidence engine
into the orchestrator is a later phase. The lifecycle, events, manifest and storage are
real.

## Auth for SSE

`EventSource` cannot set headers, so `GET /analyses/:id/events` also accepts the session
token as a `?token=` query parameter.

## Tests

```bash
pnpm --filter @proofforge/api test
```

Integration tests build the app and use `fastify.inject` against in-memory storage — the
full API runs with no database. The runner's event sequence and failure handling are tested
directly.
