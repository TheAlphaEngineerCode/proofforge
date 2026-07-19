# ProofForge CLI

The `proofforge` CLI validates and inspects proof-manifests. It is designed for CI: every
command returns a stable exit code and can emit machine-readable JSON with `--json`.

## Install / run

During development, run the built CLI directly:

```bash
pnpm --filter @proofforge/cli build
node packages/cli/dist/index.js --help
```

Once published, it will be available as the `proofforge` binary.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success — everything passed. |
| `1` | Verification failed (structure, hash or signature). |
| `2` | Usage error — bad arguments, missing/unreadable file, invalid JSON. |

## Commands

### `manifest validate <file>`

Validates a manifest against the schema.

```bash
proofforge manifest validate proof-manifest.json
proofforge manifest validate proof-manifest.json --json
```

### `manifest inspect <file>`

Prints a human-readable summary (repository, change, tests, security, risk, hash). Use
`--json` for a structured summary.

```bash
proofforge manifest inspect proof-manifest.json
```

### `evidence verify <file>`

Full verification: structure + spec version + evidence hash + optional signature.

```bash
proofforge evidence verify proof-manifest.json
proofforge evidence verify proof-manifest.json --public-key key.pub
proofforge evidence verify proof-manifest.json --require-signature
proofforge evidence verify proof-manifest.json --json
```

- `--public-key <file>` — PEM or raw base64 ed25519 public key to check the signature.
- `--require-signature` — fail unless a valid signature is present (unsigned → exit 1).

## Planned commands

| Command | Phase |
| --- | --- |
| `proofforge analyze <path>` | 2 |
| `proofforge policy validate <file>` | 6 |
| `proofforge run --task "..."` | 7 |

These are declared today and print a notice until implemented.
