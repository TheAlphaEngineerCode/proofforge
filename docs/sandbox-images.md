# Sandbox images

A repository's own tests are the one piece of evidence ProofForge cannot collect
by reading files. Running them means executing code the project did not write, so
it happens only inside a container: non-root, read-only root filesystem,
capabilities dropped, no new privileges, CPU/memory/PID capped, ephemeral, with
the repository mounted read-only and copied to a scratch volume (see
[ADR 0004](adr/0004-use-docker-sandbox.md)).

The test run is the one place the default network-off stance is relaxed, because
installing a project's dependencies needs a network. Everything else above still
holds. Static scanners never execute anything and do not use these images at all.

That container needs an image. Without Docker the test collector reports
`unavailable`; with an image it cannot pull, `docker run` fails and the collector
reports `error` carrying the registry's message, or `timeout` in the case where
the pull hangs rather than fails. The risk score charges for the unmeasured test
signal in every one of those — correctly, but the most valuable evidence in the
bundle is then the one that never arrives. Publishing these images is what turns
that status into a result.

## The images

| Stack | Image | Contents |
| --- | --- | --- |
| pytest, pytest-benchmark | `ghcr.io/thealphaengineercode/proofforge-sandbox-python:3.12` | `python:3.12-slim`, pytest, pytest-cov, uv |
| vitest | `ghcr.io/thealphaengineercode/proofforge-sandbox-node:20` | `node:20-slim`, pnpm 9.15 (installed globally, not via corepack) |

Both run as uid **10001** and own `/work` and `/out`. The uid is not incidental:
the sandbox passes `--user 10001:10001`, so an image whose directories belong to
anyone else denies every write, and the run produces an empty bundle rather than
an error anybody would notice. `.github/workflows/sandbox-images.yml` asserts the
uid, the write path and the tooling on each build, before pushing — mounting `/out`
the way the runner does, from the host rather than as a volume, since a volume
inherits the image's ownership and would pass either way.

The tooling is checked with no network and a read-only root, because it has to be
*in* the image rather than fetched on first use. That check is what caught the
node image shipping a pinned pnpm it never used: corepack keys its cache to the
current user's home, so a version prepared as root left `runner` downloading the
newest pnpm at run time — one that requires a Node this image does not have.

Sources are in [`infrastructure/docker/`](../infrastructure/docker/).

## Publishing

The workflow builds and pushes on every change to a Dockerfile, weekly, and on
demand (`workflow_dispatch`). Weekly is deliberate: the images pin `node:20-slim`
and `python:3.12-slim`, and a fix in a base image reaches the sandbox only when
something rebuilds on top of it.

Each push publishes two tags: the stack version (`:3.12`, `:20`) that the runner
pulls, and `:<commit sha>` for pinning an exact build.

The published name is derived from `github.repository_owner`, lowercased (ghcr
rejects an uppercase path), so a fork publishes to its own namespace without
editing the workflow. Pointing a fork's *runner* at those images is a separate
step — the two environment variables below.

### Make the package public, once

A package pushed by `GITHUB_TOKEN` is **private by default**. The runner pulls
anonymously, and a private image fails the pull exactly like a missing one: the
collector reports `error` either way, and only the registry's message inside the
detail tells the two apart.

After the first successful publish, open the package on GitHub → *Package
settings* → *Change visibility* → **Public**, for each of the two. It is a
one-time step per package; later pushes keep the visibility.

If the push itself fails with a 403 before you get that far, the repository's
*Settings → Actions → General → Workflow permissions* is the place to look — the
`permissions:` block in the workflow cannot grant the token more than the
repository allows it to have.

Verify from a machine that is not logged in:

```sh
docker pull ghcr.io/thealphaengineercode/proofforge-sandbox-python:3.12
```

## Pointing somewhere else

Two environment variables override the defaults, read by the evidence engine at
plan time:

```sh
PROOFFORGE_SANDBOX_PYTHON_IMAGE=registry.internal/proofforge/sandbox-python:3.12
PROOFFORGE_SANDBOX_NODE_IMAGE=registry.internal/proofforge/sandbox-node:20
```

Use them to run from an internal mirror, to test a locally built image, or in an
environment with no route to ghcr. An empty value is treated as unset, since
deployments blank a variable far more often than they remove it.

To build them under the names the runner expects:

```sh
make sandbox-images
```

## What the manifest does not record

A manifest's `environment.containerImage` is **not** filled in from any of this. It
records whatever the caller passed as `--image`, and is empty when nothing was
passed — a declaration, not an observation. The engine's toolchain does not report
back which image the sandbox actually used, so a bundle cannot currently prove it.
Closing that is worth doing: it is the one field in `environment` that claims
provenance nothing verifies.
