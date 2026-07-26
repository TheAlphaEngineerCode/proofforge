# ADR 0009 — Where the evidence pipeline executes

- Status: Accepted
- Date: 2026-07-25

## Context

The public instance on Render emits **simulated** manifests, for three independent
reasons: `EVIDENCE_ENGINE_DIR` is unset so the pipeline is never wired, the API image
carries no Python or uv, and a Render web service has no Docker daemon. Any one of them
is enough. Publishing sandbox images (ADR 0004's runtime) did not change this — those
images are what the sandbox runs, not somewhere for the sandbox to run.

So the question is not how to collect evidence; that works, and is proven by
`services/evidence-engine` and its cross-language hash conformance. The question is
**whose machine runs the customer's code**, because that is what the sandbox needs and
what a managed platform must be willing to host.

Two candidates, and they are not really competitors:

**A worker on a host with Docker.** Phase 8a already built this: `apps/api/src/worker.ts`
consumes analyses off Redis through the same factory the API uses, so with
`EVIDENCE_ENGINE_DIR`, Python, uv and a Docker daemon present it produces real evidence
with no new code at all. What it needs is a host — Render web services do not provide
one; a VM, Fly.io, or a Kubernetes node does.

**GitHub Actions as the executor.** The runner already has Docker, already has the
commit, and is paid for by whoever owns the repository. The customer's code never reaches
our infrastructure. The cost is a surface that does not exist yet: a workflow the
customer installs, an endpoint that ingests a manifest produced elsewhere, and an
authentication story for it — GitHub's OIDC token, verified against their JWKS with the
`repository` claim checked against the analysis, so that no shared secret is distributed.

## Decision

Both, with different jobs, decided by whose machine may run the code.

1. **Self-hosted and on-premises deployments run the worker.** It exists, it is tested,
   and it needs a host rather than a feature. This is the supported way to get real
   evidence today, and the answer for anyone who wants their code to stay on their
   infrastructure.

2. **The hosted service will execute in GitHub Actions.** ProofForge should not want
   custody of arbitrary customer code, and the platform where the pull request already
   lives is the one place the code is already checked out on hardware someone else pays
   for. This requires the ingestion endpoint and OIDC verification described above.

Until (2) exists, a deployment that cannot run the pipeline must **say so** rather than
quietly substituting a simulated manifest. Silence here is the failure the manifest's
`collectors[]` field was introduced to eliminate: a result that reads as measurement but
records that nothing was measured.

## Consequences

- **Positive:** the immediate unblock costs no new code — deploy the existing worker
  somewhere with a Docker daemon. The strategic path removes ProofForge from the trust
  boundary entirely rather than hardening it.
- **Negative:** two execution paths to keep working, and the hosted path adds JWT
  verification and a public ingestion endpoint, which is new attack surface that must be
  narrow: one analysis, one repository claim, one manifest.
- **Negative:** the free Render deployment cannot produce real evidence under either
  option. That is a property of the host, not of the design, and the README says so where
  the link is given.
- **Mitigation:** an instance now reports whether it can produce real evidence, at
  startup and on `/ready`, so "is this thing measuring anything?" is answerable without
  reading its configuration.
