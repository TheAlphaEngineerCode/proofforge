# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-08-03

First release. Phases 0 through 8 are complete: a change can be analyzed, executed in a
sandbox, measured, scored, judged against a policy, and bound to a `proof-manifest.json`
whose hash two independent implementations agree on. The version number says the manifest
schema and the CLI's exit codes are now things other software may depend on.

### Added

- **Evidence proved on this repository.** A CI job runs the real pipeline against the commit
  under review — the Python engine collects, the sandbox executes the tests in a container,
  and the TypeScript library verifies the manifest the engine wrote — and publishes the
  bundle as a build artifact. The project's claim, tested on the project.
- **Phase 7 — AI agents.** A provider-neutral completion interface with Anthropic and
  OpenAI-compatible implementations, cost accounting, containment for untrusted repository
  content, planning/implementation/reviewer agents, a per-run budget, and an approval gate
  between planning and implementation. All three agents have been run against a live model
  (`qwen2.5-coder:7b` on Ollama): the reviewer reported an injected SQL injection and logged
  the embedded instruction to stay silent as a suppression signal rather than obeying it;
  under a context injection the planner returned an empty plan, which the approval gate
  refuses — suppression is possible, an unreviewed approval is not. An unparseable reply
  surfaces as `NOT REVIEWED`, never as an empty findings list.
- **Phase 6 — Risk and policy engines.** A documented, reproducible risk score whose weights
  are published, charging for security signals that were not measured rather than reading
  their absence as clean; YAML policies with schema validation, versioning, violations,
  blocking and audited exceptions; `proofforge policy validate|evaluate` and `proofforge init`.
- **Phase 5 — GitHub App.** `packages/github`: webhook signature verification (timing-safe
  HMAC-SHA256 over the raw body), event normalization, App JWT to installation token, a REST
  client behind an interface, and a deterministic verdict published as a Check Run and a PR
  comment updated in place. Deliveries are idempotent per commit and are routed to the
  organization that claimed the installation, proved by the `sender` GitHub itself signed —
  a repository name alone would let a squatter claim someone else's repository. Sign-in is
  GitHub OAuth on the same App's credentials, with the `state` signed rather than stored and
  bound to the browser that started the login by a short-lived `HttpOnly` cookie.
- **Observability.** Structured JSON logging with credential redaction, plus counters and
  histograms at `GET /metrics` in Prometheus format, closed by default in production unless
  `METRICS_TOKEN` is set. Collector provenance is counted by status, so a collector that has
  been unavailable for a week cannot read as a week of clean results.
- **Published sandbox runner images.** `ghcr.io/thealphaengineercode/proofforge-sandbox-python`
  and `-node`, built, hardened-checked and published by CI, pulled by default and overridable
  by environment variable. The manifest reports the image that actually ran, by digest.
- **Phase 8 (queue + workers) — distributing the pipeline.** `packages/queue`: a `JobQueue`
  interface with an in-process backend and a BullMQ/Redis backend, plus a `RedisEventBus` that
  carries pipeline events across processes. `apps/api` gains a `worker` entrypoint and selects
  its backend from `REDIS_URL` — unset runs analyses in-process exactly as before; set, the API
  only enqueues and one or more workers run them, streaming events back over Redis to the SSE
  route. Deliveries are idempotent (the analysis id is the job id) and failed jobs are retried
  with backoff. The distributed path is proven end to end against a real Redis: an enqueued
  analysis runs to a terminal state in a separate worker and its events arrive on the API's bus.
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

### Fixed

Four defects the new CI job surfaced in its first hours, each hidden behind the one
before it — none of them findable by reading the code, all of them found by running it.

- **The sandbox could not write the reports it had just produced.** This is why the test
  collector had never worked outside fixtures. `mkdtemp` creates the output directory as
  0700 owned by whoever starts the engine, while the container runs as uid 10001 — which
  is the point of running someone else's tests in a container — so on any real host
  pytest passed and then died on `Permission denied: '/out/junit.xml'`. It went unnoticed
  because Docker Desktop's bind mounts ignore file modes: it worked on a laptop and
  failed everywhere that mattered. The per-run directory is now opened to the container
  user.
- **The manifest could name a confident wrong cause.** A failing collector reported the
  first 300 characters of the tool's stderr, and a tool that fetches something fills
  those with progress: the first run blamed a Docker image pull that had in fact
  succeeded, while the real failure minutes later never appeared. All three call sites
  now read the tail, marked with an ellipsis so a truncated message is not mistaken for
  a complete one.
- **The pytest runner could not install a uv project.** It passed `uv sync --active`,
  which the uv pinned in the sandbox image does not accept; under `set -e` the script
  died before pytest, so every uv-based repository this runner has been pointed at
  reported "no JUnit report produced". Removing the flag alone produces a worse answer —
  a bare `uv sync` on a workspace root installs no members, the tests cannot import what
  they test, and the resulting collection errors read as a failing suite. With
  `--all-packages` the workspace goes from 14 collection errors to 170 passing tests
  with coverage, verified inside the published image; a single-package project is
  unaffected.
- **A collector had no way to be given more time.** The per-tool timeout was fixed at
  300 seconds, which the test collector can spend entirely on installing dependencies.
  `PROOFFORGE_TOOL_TIMEOUT_S` raises it; a value that is not a positive integer is
  ignored, since a zero timeout would fail every collector instantly and read as a
  repository with nothing to measure.

### Security

- **vitest raised to 3.2.6** for CVE-2026-47429, where the Vitest UI server can read and
  execute arbitrary files. It accounted for 14 of the 19 open advisories on the default
  branch. `@vitest/coverage-v8` moves with it: raised alone, the mismatched pair reports
  branch coverage of 81.25% against an 85% threshold, and in lockstep the same code
  measures 92.06% — so the gate is unchanged.

### Not built, deliberately

Kubernetes manifests, a Helm chart, published API/worker images, distributed tracing and a
plugin SDK were all planned and are out of scope. [ROADMAP.md](./ROADMAP.md) gives the
reasoning for each rather than leaving them listed as pending forever.

[Unreleased]: https://github.com/TheAlphaEngineerCode/proofforge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/TheAlphaEngineerCode/proofforge/releases/tag/v1.0.0
