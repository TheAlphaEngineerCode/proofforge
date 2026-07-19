# ADR 0002 — Use TypeScript and Python

- Status: Accepted
- Date: 2026-07-18

## Context

The system needs strong orchestration/API/CLI ergonomics and best-in-class code analysis
tooling. No single language is best at both.

## Decision

Use **TypeScript** for the core (CLI, API, orchestrator, packages) and **Python** for the
analysis services (Repository Analyzer, parts of the Evidence Engine), where Tree-sitter,
Semgrep, Ruff and the AST ecosystem are strongest.

## Consequences

- **Positive:** each concern uses the best tool; large talent pool for both.
- **Negative:** two toolchains (pnpm/Turbo + uv/Ruff/mypy) and a language boundary.
- **Mitigation:** the `proof-manifest` JSON contract is the interop boundary; both sides
  validate against the same JSON Schema.
