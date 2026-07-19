# ADR 0008 — Canonical hashing and ed25519 signatures

- Status: Accepted
- Date: 2026-07-18

## Context

A proof-manifest must be verifiable by any other machine: two parties should compute the
same digest for the same evidence, and be able to detect tampering.

## Decision

Compute the `evidenceHash` as `sha256:<hex>` over a **canonical JSON serialization**
(sorted object keys, no insignificant whitespace, finite numbers — the essentials of
RFC 8785). The fields excluded from hashing are `evidenceHash` itself and
`signature.value`, set to empty strings before canonicalization. Signatures are **ed25519**
over the `evidenceHash` string; because the hash already binds the full document, signing
it is equivalent to signing the whole manifest.

## Consequences

- **Positive:** deterministic, reproducible verification; small stable signed payload;
  tampering with any field breaks the hash.
- **Negative:** producers and consumers must agree on canonicalization exactly.
- **Mitigation:** a single shared implementation in `evidence-spec`, covered by
  order-independence and tamper-detection tests; unsigned manifests are allowed for local
  runs and clearly reported as such.
