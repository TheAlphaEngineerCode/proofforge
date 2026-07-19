# ProofForge Dashboard

The Next.js (App Router) dashboard for ProofForge. Connects a repository, starts an analysis,
watches the pipeline live over Server-Sent Events, and shows the resulting proof-manifest.

## Run

```bash
# start the API first (defaults to :3001)
pnpm --filter @proofforge/api dev

# then the dashboard (defaults to :3000)
pnpm --filter @proofforge/web dev
```

Configure the API endpoint with `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001`).

## Pages

- `/` — landing page (product pitch, CLI verify snippet).
- `/dashboard` — organizations and connected repositories; create orgs and connect repos.
- `/repositories/[id]` — repository detail, analysis history, and "Run an analysis".
- `/analyses/[id]` — live pipeline timeline (SSE), risk, and the proof-manifest (with raw view).

## Auth

Uses the API's dev-login for a local session (token in `localStorage`). GitHub OAuth arrives in
Phase 5 and issues the same session tokens. The SSE stream authenticates via a `?token=` query
parameter because `EventSource` cannot set headers; the API redacts that token from its logs.

## Styling

Hand-written CSS (`src/app/globals.css`) with a dark theme and CSS variables — no build-time CSS
framework, to keep the toolchain minimal. Tailwind + shadcn/ui are a planned refinement.

## Build

```bash
pnpm --filter @proofforge/web build   # next build (type-checks and compiles)
pnpm --filter @proofforge/web typecheck
```
