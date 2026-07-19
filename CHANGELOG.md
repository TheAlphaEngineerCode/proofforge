# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Phase 0 — Foundation.** Monorepo scaffolding with pnpm workspaces and Turborepo;
  shared TypeScript and Python configuration; Prettier, ESLint, Vitest and Ruff/mypy;
  Docker Compose for PostgreSQL, Redis and MinIO; Makefile and developer scripts; GitHub
  Actions CI; institutional documentation and ADRs 0001–0008.
- **Phase 4 (dashboard) — Next.js UI.** `apps/web` (Next.js App Router): a landing page, a
  dashboard for organizations and repositories, a repository page (analysis history +
  trigger), and an analysis page with a live SSE pipeline timeline and the rendered
  proof-manifest — served by a typed API client and a dev-login session. Builds clean with
  type checking; all routes serve HTTP 200.
- **Phase 4 (backend) — API & data layer.** `packages/shared-types` (shared DTOs, the
  analysis state machine and SSE event types); `packages/database` (Drizzle/PostgreSQL
  schema for all entities, a `Storage` interface and an in-memory backend); `apps/api`
  (Fastify): bearer-token session auth with organization-scoped tenant isolation, the REST
  surface (organizations, repositories, analyses, evidence bundles, policies, health), an
  in-process analysis runner that walks the state machine and streams status over SSE, and a
  real schema-valid `proof-manifest.json` per analysis — verified end-to-end by the CLI over
  HTTP. Dev-login is forced off in production. 33 tests (state machine, storage, config, API
  integration via `fastify.inject`).
- **Phase 3 — Evidence Engine.** `services/evidence-engine` (Python): collectors that parse
  JUnit/Cobertura, Gitleaks, Semgrep, Trivy and Syft output into consolidated evidence; a
  hardened Docker sandbox command builder (network-off, non-root, CPU/memory/PID limits,
  read-only rootfs, dropped capabilities) for test execution; a transparent interim risk
  score; and a manifest builder producing a schema-valid `proof-manifest.json`. The Python
  canonicalization/hash matches `packages/evidence-spec` byte-for-byte, so an engine-produced
  manifest is verified by the TypeScript `proofforge evidence verify`. `proofforge-evidence`
  CLI persists an evidence bundle (manifest + raw reports + `evidence.json`). 20 tests
  (parsers, sandbox hardening, engine consolidation, cross-language hash conformance).
- **Phase 2 — Repository Analyzer.** `services/repository-analyzer` (Python): read-only
  detection of languages, frameworks, package managers, databases, infrastructure, CI, test
  and lint tooling, entrypoints, migrations, env vars, modules and dependencies; a coarse
  architecture graph and risk-area flags; the `proofforge-analyzer` CLI (`--json`,
  `--output`) emitting a structured `AnalysisReport`; Node and Python fixtures with pytest,
  Ruff and mypy (strict).
- **Phase 1 — Evidence Spec & CLI.** `@proofforge/evidence-spec` with the canonical Zod
  schema for the proof-manifest, JSON Schema generation, deterministic canonicalization and
  SHA-256 evidence hashing, and ed25519 signature verification. `@proofforge/cli`
  (`proofforge`) with `manifest validate`, `manifest inspect` and `evidence verify`, plus
  valid/invalid example manifests and conformance tests.

[Unreleased]: https://github.com/proofforge/proofforge/commits/main
