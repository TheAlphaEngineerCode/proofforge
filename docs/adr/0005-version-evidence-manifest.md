# ADR 0005 — Version the evidence manifest

- Status: Accepted
- Date: 2026-07-18

## Context

The `proof-manifest.json` is a long-lived, machine-verifiable contract consumed across
languages, CI systems and time. It will evolve.

## Decision

Give the manifest a `specVersion` following **Semantic Versioning**. Validators accept any
manifest whose MAJOR version is supported; MINOR/PATCH bumps are backward compatible
(additive, optional fields only). Breaking changes require a MAJOR bump and a documented
migration.

## Consequences

- **Positive:** old manifests remain verifiable; consumers can gate on MAJOR.
- **Negative:** additive-only discipline constrains schema evolution.
- **Mitigation:** conformance tests with valid/invalid fixtures per version; the JSON
  Schema is generated from the canonical Zod schema so both never drift.
