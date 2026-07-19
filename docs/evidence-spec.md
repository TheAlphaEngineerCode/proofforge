# Evidence Spec — the proof-manifest

The `proof-manifest.json` is ProofForge's trust anchor: a self-describing, hashable and
signable record that binds evidence to a specific commit. This document describes the
contract implemented by `@proofforge/evidence-spec`.

## Versioning

The manifest carries a `specVersion` (SemVer). Validators accept any manifest whose MAJOR
version is supported; MINOR/PATCH bumps only add optional fields (see
[ADR 0005](./adr/0005-version-evidence-manifest.md)). Current spec version: **1.0.0**.

## Structure

Top-level fields:

| Field | Purpose |
| --- | --- |
| `specVersion` | Manifest schema version (SemVer). |
| `id` | UUID identifying this manifest. |
| `repository` | Provider, owner, name, URL. |
| `change` | Commit, base commit, branch, PR number, title, request, mode. |
| `environment` | Runner/OS/container image and runtime + lockfile hashes. |
| `tests` | Pass/fail/skip counts, duration, coverage (total + changed lines). |
| `security` | Vulnerability counts by severity, secrets, SBOM. |
| `quality` | Complexity, duplication, dependency and architecture deltas. |
| `performance` | Benchmarks with baseline vs candidate and regression %. |
| `operations` | Migrations, reversibility, rollback, downtime. |
| `risk` | Score (0–100), level, per-category breakdown, reasons. |
| `policies` | Passed/failed/warning policy outcomes. |
| `agents` | Agent runs with provider, model and cost. |
| `artifacts` | References to stored reports/SBOMs. |
| `evidenceHash` | `sha256:<hex>` digest over the canonical manifest. |
| `signature` | Optional ed25519 signature. |
| `createdAt` | ISO-8601 timestamp. |

The authoritative definition is the Zod schema in
[`packages/evidence-spec/src/schema.ts`](../packages/evidence-spec/src/schema.ts). A
JSON Schema is generated from it (`pnpm --filter @proofforge/evidence-spec generate:schema`
→ `schema/proof-manifest.schema.json`).

## Canonicalization

Hashing requires a byte-identical serialization across machines. ProofForge uses a
canonical JSON form (the essentials of RFC 8785):

- object keys sorted lexicographically;
- no insignificant whitespace;
- arrays keep order;
- only finite numbers (NaN/Infinity rejected);
- `undefined` properties dropped.

## Evidence hash

```text
evidenceHash = "sha256:" + hex( sha256( canonical( manifest without evidenceHash and signature.value ) ) )
```

Both `evidenceHash` and `signature.value` are set to `""` before canonicalization, so a
manifest can carry its own digest. Changing **any** other field changes the hash.

## Signature

Signatures are **ed25519** over the `evidenceHash` string. Since the hash binds the whole
document, signing it is equivalent to signing the manifest. Keys may be PEM or raw base64.
A manifest with an empty `signature.value` is **unsigned** — permitted for local runs and
reported as such by the CLI. Verification statuses: `valid`, `invalid`, `unsigned`,
`no-key`.

## Library API

```ts
import {
  validateManifestStructure, // schema-only validation
  verifyManifest,            // structure + version + hash + optional signature
  computeEvidenceHash,       // deterministic digest
  verifyEvidenceHash,        // recompute and compare
  signEvidenceHash,          // ed25519 sign
  verifySignature,           // ed25519 verify
  getManifestJsonSchema,     // JSON Schema (generated)
  ManifestSchema,            // Zod schema (source of truth)
  SPEC_VERSION,
} from "@proofforge/evidence-spec";
```

## Examples

- Valid: [`examples/valid/github-oauth.json`](../packages/evidence-spec/examples/valid/github-oauth.json)
  (generated with a correct hash).
- Invalid: [`examples/invalid/`](../packages/evidence-spec/examples/invalid/) — used as
  negative conformance fixtures.
