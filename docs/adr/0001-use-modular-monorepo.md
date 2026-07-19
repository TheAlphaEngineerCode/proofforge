# ADR 0001 — Use a modular monorepo

- Status: Accepted
- Date: 2026-07-18

## Context

ProofForge spans many components (CLI, spec, API, dashboard, analysis services, agents).
We must ship a coherent foundation quickly while keeping the door open to extracting
services later.

## Decision

Start as a **modular monorepo** managed with pnpm workspaces and Turborepo. Boundaries are
enforced by package structure and explicit dependencies, not by network calls. Services are
extracted only when there is an operational justification (independent scaling, isolation,
separate release cadence).

## Consequences

- **Positive:** one clone to run everything; shared tooling (TS config, lint, tests);
  atomic cross-package changes; fast iteration.
- **Negative:** requires discipline to keep module boundaries clean; a large repo.
- **Mitigation:** clear `packages/` vs `services/` vs `apps/` separation; ADRs for
  extraction decisions.
