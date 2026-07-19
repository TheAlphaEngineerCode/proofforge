# ADR 0004 — Execute untrusted code in Docker sandboxes

- Status: Accepted
- Date: 2026-07-18

## Context

ProofForge runs tests and tools from arbitrary repositories. This code is untrusted and
must never affect the host or other tenants.

## Decision

Execute all repository code in **ephemeral Docker containers** (Kubernetes Jobs in
production): non-root user, read-only/temporary filesystem, CPU/memory limits, execution
timeouts, **network disabled by default** (allowlist when required), temporary secrets,
automatic cleanup, and protections against fork bombs and disk exhaustion.

## Consequences

- **Positive:** strong isolation with a well-understood, portable runtime.
- **Negative:** container runtime required; some overhead per job.
- **Mitigation:** the sandbox interface is abstracted (`services/sandbox-runner`) so
  stronger isolation (gVisor, Firecracker, Kata) can be adopted later without changing
  callers.
