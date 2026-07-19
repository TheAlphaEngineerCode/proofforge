# ProofForge — Roadmap

ProofForge is built in phases. Each phase leaves the project **executable** and adds a
verifiable capability. AI agents come last, on top of a solid, deterministic foundation.

Legend: ✅ done · 🚧 in progress · ⬜ planned

## Phase 0 — Foundation ✅

Monorepo (pnpm + Turborepo), shared TS/Python config, lint, tests, Docker Compose
(PostgreSQL, Redis, MinIO), Makefile, CI, initial documentation.

**Done when:** everything compiles, local infra comes up with one command, example tests
pass, CI is green, README is complete.

## Phase 1 — Evidence Spec & CLI ✅

JSON Schema of the manifest (generated from a canonical Zod schema), validation library,
deterministic hashing, ed25519 signatures, valid/invalid examples, conformance tests, and
the `proofforge` CLI (`manifest validate`, `manifest inspect`, `evidence verify`).

**Done when:** `proofforge manifest validate` accepts valid and rejects invalid manifests,
hashes are reproducible, tests cover the main cases, docs are published.

## Phase 2 — Repository Analyzer ✅

Detect languages, frameworks, package managers, databases, infra, CI, tests, lint tools,
entrypoints, migrations, env vars, modules and dependencies; build a coarse dependency/
architecture graph; flag high-risk and untested areas. Python (`services/repository-analyzer`),
read-only — never executes repository code.

**Done when:** analyzes a Node.js and a Python project, produces structured JSON, writes
the result to a file, and surfaces it via the CLI. ✅ (manifest-based detection; Tree-sitter
AST module extraction is a later enhancement.)

## Phase 3 — Evidence Engine (sandboxed) ✅

Run coverage/test, Semgrep, Trivy, Gitleaks and SBOM collection, consolidate results and
emit a manifest. `services/evidence-engine` (Python) parses each tool's output, computes a
transparent interim risk, and builds a schema-valid `proof-manifest.json` whose
`evidenceHash` is **cross-verified by the TypeScript CLI**. Static scanners run on the host;
test execution is confined to a hardened Docker sandbox (`--network none`, non-root,
CPU/memory/PID limits, read-only rootfs, `--cap-drop ALL`) — repository code never runs on
the host.

**Done when:** execution is isolated, a manifest is generated and cross-language verified,
evidence is persisted, failures/unavailable tools are reported cleanly. ✅ (Wiring concrete
per-stack sandbox runner images for test execution is the remaining integration step; the
hardened sandbox command builder is implemented and unit-tested.)

## Phase 4 — API & Dashboard ✅

Authentication, organizations, repositories, analyses, evidence bundles, risk score,
policies; Next.js dashboard with real-time status.

- **Backend** — `packages/shared-types` (DTOs + analysis state machine + events),
  `packages/database` (Drizzle/PostgreSQL schema + `Storage` interface + in-memory backend),
  `apps/api` (Fastify): bearer-token auth with tenant isolation, the full REST surface, an
  in-process analysis runner walking the state machine, an SSE event stream, and a real
  schema-valid `proof-manifest.json` per analysis (verified end-to-end by the CLI over HTTP).
- **Dashboard** — `apps/web` (Next.js App Router): landing page, dashboard (orgs +
  repositories), repository page (analysis history + trigger), and an analysis page with a
  **live SSE pipeline timeline** and the rendered proof-manifest.

**Done when:** login works, a repo is connected, an analysis starts from the UI, status is
live, a visual report is available. ✅ (GitHub OAuth login is Phase 5; local dev-login works
today. Wiring the Python evidence engine into the runner is later-phase.)

## Phase 5 — GitHub App ⬜

Install flow, webhooks, PR analysis, Checks API, PR comments, installation storage, minimal
permissions, signature-validated webhooks.

**Done when:** a PR triggers an analysis, status appears in GitHub, a comment is posted,
permissions are minimal, webhooks are validated.

## Phase 6 — Risk & Policy Engines ⬜

Deterministic, documented risk scoring; YAML policies with schema validation, versioning,
violations, blocking and audited exceptions.

**Done when:** the score is reproducible, policies are validated, violations are shown,
exceptions are audited, coverage is high.

## Phase 7 — AI Agents ⬜

Provider-agnostic AI layer and the Architect, Planning, Implementation, Reviewer and
Evidence agents; cost control, logging, plan approval, prompt-injection defense.

**Done when:** a user describes a task, a plan is generated and approved, a branch is
created, the change is implemented, an independent review runs, and evidence is produced.

## Phase 8 — Distributed system ⬜

Queues, workers, retries, idempotency, scalability, Kubernetes, Helm, distributed tracing.

**Done when:** many jobs run in parallel, failures recover, jobs are idempotent, metrics
are available, deploys are reproducible.

## Phase 9 — SDK & plugins ⬜

SDK plus plugin points for analyzers, policies and evidence collectors, with docs and
examples.

**Done when:** an external plugin can be created against a stable API with a working
example and sufficient documentation.
