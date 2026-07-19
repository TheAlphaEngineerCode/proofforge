# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**. Do not open a public issue.

- Use GitHub's **private vulnerability reporting** ("Report a vulnerability" under the
  Security tab), or
- email the maintainers with details and reproduction steps.

We aim to acknowledge reports within **72 hours** and to provide a remediation timeline
after triage. Please give us reasonable time to fix an issue before public disclosure.

## Scope

ProofForge executes and analyzes untrusted code. Security is foundational, not an add-on.
The following are in scope:

- Sandbox escapes or any path by which repository code affects the host.
- Prompt injection: repository content (README, comments, code, issues) causing an agent
  to violate system policy, exfiltrate secrets, or use out-of-scope tools.
- Secret handling: exposure of GitHub tokens, signing keys or provider credentials.
- Manifest integrity: forging a valid `evidenceHash` or signature.
- Webhook forgery: bypassing GitHub signature validation.
- Tenant isolation: one organization accessing another's data.
- Authentication/authorization flaws, SSRF, command injection, path traversal.

## Our commitments (by design)

- Repository code **never runs on the host** — only in ephemeral, non-root,
  resource-limited, network-isolated sandboxes.
- All repository content is treated as **untrusted input**. Agents do not follow
  instructions found in a repository that contradict system policies.
- GitHub tokens are **never stored in plaintext**; secrets never enter prompts.
- Manifests are protected by a deterministic SHA-256 `evidenceHash` and optional ed25519
  signatures, independently verifiable via `proofforge evidence verify`.
- Least privilege and audit logging across all actions.

See [ARCHITECTURE.md](./ARCHITECTURE.md) and (from Phase 5) `THREAT_MODEL.md` for details.

## Supported versions

ProofForge is pre-1.0. Security fixes target the latest `main`.
