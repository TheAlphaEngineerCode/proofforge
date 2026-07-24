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

### `evidence build <path>`

Runs the evidence engine (a Python service) over a local repository and **verifies the
manifest it produces** with the same library `evidence verify` uses. This is the whole
deterministic pipeline — collectors, sandboxed test execution, risk scoring — reachable as
one command. No AI and no server are involved.

```bash
proofforge evidence build .
proofforge evidence build . --base main --output-dir ./bundle
proofforge evidence build . --signing-key key.pem
proofforge evidence build . --json
```

- The change context (owner, name, url, commit, base, branch) is read from git and can be
  overridden; `--base <sha>` sets the commit the diff is taken against (default `HEAD~1`).
- `--output-dir <dir>` — where the bundle is written (default `<repo>/.proofforge/bundle`).
- `--signing-key <file>` — ed25519 private key (PEM or raw base64) to sign the manifest.
- `--image <digest>` — sandbox image digest to record in the manifest.
- Exit `0` only when the engine built a bundle **and** the manifest verifies; the engine not
  being installed exits `2` (nothing ran), a manifest that fails verification exits `1`.
- The engine runs as a Python service under `uv`; set `PROOFFORGE_EVIDENCE_DIR` if it is not
  found automatically.

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

### `analyze <path>`

Runs the repository analyzer (a Python service) over a local checkout — read-only structural
detection, never executing repository code. Use `--json` for machine-readable output.

```bash
proofforge analyze .
proofforge analyze . --json
```

The analyzer runs under `uv`; set `PROOFFORGE_ANALYZER_DIR` if it is not found automatically.
A missing analyzer exits `2` (nothing ran), distinct from a repository with nothing to report.

### `init`

Writes a starting `proofforge-policy.yml` into the current repository. `--force` overwrites an
existing file.

## Declared but unavailable

| Command | Why |
| --- | --- |
| `proofforge run --task "..."` | agents are not wired into the CLI yet |

It appears in `--help`, writes the reason to stderr, and **exits 2** — a script
calling it cannot mistake "did nothing" for "succeeded".
