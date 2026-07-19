# ProofForge — Architecture

ProofForge is a **modular monorepo** that turns software changes into auditable,
reproducible, verifiable evidence. This document describes the target architecture and
what exists today.

## Core principle: Proof-Carrying Change

A change is not trustworthy until it carries verifiable technical evidence. Every analyzed
or generated change produces a `proof-manifest.json` — a self-describing, hashable and
signable record binding tests, security, quality, performance and operational evidence to
a specific commit.

Two properties make it trustworthy:

1. **Separation of generation and validation.** The components that *write* code (agents)
   are distinct from the components that *judge* it (evidence, risk, policy engines). A
   reviewer agent independently critiques the implementation agent's work.
2. **Determinism.** Evidence is hashed over a canonical serialization so any machine
   recomputes the same digest and reaches the same verdict.

## Logical components

```text
                        ┌────────────────────┐
                        │    Web Dashboard   │  Next.js (Phase 4)
                        └─────────┬──────────┘
                                  │
                        ┌─────────▼──────────┐
                        │    API Gateway     │  Fastify/Node (Phase 4)
                        └─────────┬──────────┘
                                  │
               ┌──────────────────┼───────────────────┐
      ┌────────▼────────┐ ┌───────▼────────┐ ┌────────▼───────┐
      │ Repository      │ │ Agent          │ │ Evidence       │
      │ Analyzer (Py)   │ │ Orchestrator   │ │ Engine (Py/TS) │
      │ Phase 2         │ │ (TS) Phase 7   │ │ Phase 3        │
      └────────┬────────┘ └───────┬────────┘ └────────┬───────┘
               └──────────────────┼───────────────────┘
                        ┌─────────▼──────────┐
                        │ Queue / Event Bus  │  Redis/NATS (Phase 8)
                        └─────────┬──────────┘
                        ┌─────────▼──────────┐
                        │ Sandbox Workers    │  Docker/K8s (Phase 3/8)
                        └─────────┬──────────┘
           ┌──────────────────────┼──────────────────────┐
    ┌──────▼──────┐       ┌───────▼──────┐       ┌────────▼──────┐
    │ PostgreSQL  │       │ Object Store │       │ Observability │
    │ (metadata)  │       │ (S3/MinIO)   │       │ (OTel)        │
    └─────────────┘       └──────────────┘       └───────────────┘
```

## What exists today (Phase 0–1)

- **`packages/evidence-spec`** — the canonical proof-manifest schema (Zod), JSON Schema
  generation, deterministic canonicalization + SHA-256 hashing, and ed25519 signature
  verification. This is the trust anchor of the whole system and has no I/O beyond Node's
  crypto primitives.
- **`packages/cli`** — the `proofforge` CLI wrapping the spec: `manifest validate`,
  `manifest inspect`, `evidence verify`. Stable exit codes make it CI-friendly.
- **`services/repository-analyzer`** — read-only Python analyzer that detects languages,
  frameworks, package managers, databases, infrastructure, CI, tests, lint tooling,
  entrypoints, migrations, env vars, modules and dependencies, and builds a coarse
  architecture graph and risk-area list. Emits a structured `AnalysisReport` via the
  `proofforge-analyzer` CLI. Never executes repository code.
- **`services/evidence-engine`** — Python engine that runs collectors (JUnit/Cobertura,
  Gitleaks, Semgrep, Trivy, Syft), consolidates evidence, computes an interim risk score and
  builds a schema-valid `proof-manifest.json`. Its canonicalization/hash matches
  `packages/evidence-spec` byte-for-byte (cross-language verifiable). Test execution is
  confined to a hardened Docker sandbox; static scanners run on the host; repository code
  never runs on the host.
- **`packages/shared-types`** — DTOs, the analysis state machine and SSE event types shared
  by the API and the dashboard.
- **`packages/database`** — Drizzle/PostgreSQL schema for every entity plus a `Storage`
  interface with an in-memory backend (local/tests) and a PostgreSQL client factory.
- **`apps/api`** — Fastify REST API: bearer-token session auth with organization-scoped
  tenant isolation; organizations, repositories, analyses, evidence bundles and policies; an
  in-process analysis runner that walks the state machine and streams status over SSE; and a
  schema-valid `proof-manifest.json` per analysis, verifiable by the CLI.
- **`apps/web`** — Next.js (App Router) dashboard: landing page, organizations/repositories
  dashboard, repository detail with analysis triggering, and an analysis page with a live SSE
  pipeline timeline and the rendered proof-manifest. Consumes the API via a typed client.
- **Root workspace** — pnpm + Turborepo, shared TypeScript config, Vitest, Prettier,
  ESLint, uv for Python, Docker Compose (Postgres/Redis/MinIO), Makefile, GitHub Actions.

Everything else in the diagram is planned; see [ROADMAP.md](./ROADMAP.md).

## Repository layout

```text
proofforge/
├── apps/           # web, api, worker, github-app, docs (Phase 4+)
├── services/       # repository-analyzer, evidence-engine, risk/policy, sandbox-runner (Py)
├── packages/       # evidence-spec ✅, cli ✅, sdk, shared-types, database, ai-providers, …
├── policies/       # default / strict / example policy sets
├── examples/       # sample repositories to analyze
├── infrastructure/ # docker, kubernetes, helm, terraform
├── docs/           # documentation + ADRs
└── scripts/        # dev tooling
```

## Data flow (target)

1. Authenticate via GitHub, connect a repository.
2. Clone into an isolated sandbox; the **Repository Analyzer** detects language, framework,
   dependencies and builds an architecture map.
3. The user provides a task (agent mode) or selects a PR (validation mode).
4. A **plan** is generated and optionally approved by a human.
5. The **Implementation Agent** applies changes on a branch; the **Reviewer Agent**
   critiques them independently.
6. The **Evidence Engine** runs tests, security scans, benchmarks and quality analysis in
   the sandbox and consolidates results.
7. The **Risk Engine** computes a deterministic, explainable score; the **Policy Engine**
   applies YAML policies and records violations.
8. The **Evidence Agent** produces the `proof-manifest.json`, computes its hash and signs
   it.
9. Results surface on the dashboard and, for PRs, as a GitHub check + comment. The manifest
   can be independently re-verified by the CLI.

## Security model

- **Untrusted input.** Everything from a repository — README, comments, code, issues — is
  treated as untrusted. Agents never follow instructions found in a repository that
  contradict system policy (prompt-injection defense, Phase 7).
- **Sandboxing.** Repository code never runs on the host. Sandboxes are ephemeral,
  non-root, resource-limited, network-off by default, and destroyed after use (Phase 3).
- **Secrets.** GitHub tokens are never stored in plaintext; secrets never enter prompts.
- **Least privilege** and **tenant isolation** across organizations.

Details in [docs/security.md](./docs/security.md) and [THREAT_MODEL.md](./THREAT_MODEL.md)
(Phase 5+).

## Technology choices

See the Architecture Decision Records in [docs/adr/](./docs/adr/):

- `0001` modular monorepo · `0002` TypeScript + Python · `0003` PostgreSQL ·
  `0004` Docker sandbox · `0005` versioned evidence manifest ·
  `0006` provider-agnostic AI layer · `0007` Zod as source of truth ·
  `0008` canonical hashing + ed25519 signature.
