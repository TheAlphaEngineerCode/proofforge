# ADR 0007 — Zod as the single source of truth for the schema

- Status: Accepted
- Date: 2026-07-18

## Context

We need both runtime validation in TypeScript and a language-neutral JSON Schema for
external consumers. Maintaining two schemas by hand guarantees drift.

## Decision

Author the manifest schema **once in Zod** (`packages/evidence-spec/src/schema.ts`) and
**generate** the JSON Schema from it via `zod-to-json-schema`. Runtime validation uses Zod;
the emitted `schema/proof-manifest.schema.json` is a build artifact for external tools.

## Consequences

- **Positive:** one source of truth; validation and schema can never disagree; rich TS
  types inferred for free.
- **Negative:** the JSON Schema is only as expressive as the generator allows.
- **Mitigation:** a test asserts the generated schema contains the expected required
  fields; regeneration is part of the build.
