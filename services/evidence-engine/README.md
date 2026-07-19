# ProofForge Evidence Engine

Runs analysis over a change and consolidates the results into a verifiable
`proof-manifest.json` whose hash is **cross-compatible with the TypeScript
`packages/evidence-spec`** — a manifest produced here verifies under
`proofforge evidence verify`.

## What it does

- Runs collectors and normalizes their output into structured evidence:
  - **tests / coverage** — JUnit + Cobertura (pytest, Vitest, Jest, …);
  - **secrets** — Gitleaks;
  - **SAST** — Semgrep;
  - **vulnerabilities** — Trivy;
  - **SBOM** — Syft.
- Computes a transparent **interim risk** score (the full Risk Engine is Phase 6).
- Builds a schema-valid manifest, stamps a deterministic `evidenceHash`, and
  persists an evidence bundle (manifest + raw tool reports + a consolidated
  `evidence.json`).

## Isolation

Static scanners only read files and run on the host. **Test execution runs
repository code and therefore only happens inside the sandbox — never on the
host.** The sandbox (`sandbox.py`) builds a hardened `docker run`: `--network
none` by default, non-root user, CPU/memory/PID limits, read-only root with a
size-limited tmpfs, `--cap-drop ALL` and `--security-opt no-new-privileges`, and
a read-only mount of the repository. When a tool or the sandbox is unavailable the
run is reported cleanly and the manifest is still produced.

## Usage

```bash
# from services/evidence-engine
uv sync
uv run proofforge-evidence build \
  --repo /path/to/repo \
  --owner acme --name api --url https://github.com/acme/api \
  --commit <sha> --base <sha> --branch feature/x --pr 42 \
  --output-dir .proofforge/bundle

# then verify the produced manifest with the TypeScript CLI:
node ../../packages/cli/dist/index.js evidence verify .proofforge/bundle/proof-manifest.json
```

Exit codes: `0` bundle built · `2` usage error.

> **Bundle sensitivity.** Raw reports (e.g. Gitleaks) can contain matched secret
> values. The engine writes a catch-all `.gitignore` into every bundle directory
> so it is never committed by accident; treat the bundle as sensitive and store it
> with appropriate access control.

## Development

```bash
uv sync
uv run ruff check .
uv run mypy
uv run pytest
```

Parsers are pure functions tested against recorded tool output; the engine is
tested with a fake toolchain, so the full pipeline runs without any tools or
Docker installed.

## Scope note (Phase 3)

Static evidence collection, consolidation, risk and manifest generation are
complete and verified. Wiring concrete per-stack sandbox runner images for test
execution is the remaining integration step; the hardened sandbox command builder
is implemented and unit-tested. Quality, performance and operations fields carry
honest "not yet measured" defaults, enriched in later phases.
