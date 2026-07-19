# Contributing to ProofForge

Thanks for your interest in ProofForge. This project turns software changes into
verifiable evidence — so we hold our own changes to the same bar.

## Getting started

```bash
git clone <repository>
cd proofforge
cp .env.example .env
make setup     # install JS (pnpm) + Python (uv) dependencies
make build
make test
```

Requirements: **Node ≥ 20.11**, **pnpm ≥ 9**, **Python ≥ 3.12** (for services),
and **Docker** for local infrastructure (`make docker-up`).

## Development workflow

We work in small, verifiable steps. For every change:

1. Understand the current state and state your objective.
2. Implement.
3. `make lint` — lint passes.
4. `make typecheck` — no type errors (TypeScript strict; avoid `any`).
5. `make test` — tests pass, including new ones for your change.
6. Update documentation.

Tests live next to the code they cover. Critical modules must stay well covered — the
`evidence-spec` package targets **90%+**.

## Coding standards

- **TypeScript**: strict mode, no `any`, typed errors, structured logs, small functions,
  explicit dependencies, descriptive names, no dead code, no secrets, no hardcoded
  production values.
- **Python**: type hints, Ruff, mypy (strict), pytest, Pydantic, explicit errors.

## Commits & pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `docs:`, `chore:`, `refactor:`, `test:`, etc.
- Keep PRs focused. Describe the change, the reasoning, and how you verified it.
- CI must be green (lint, typecheck, tests, security scans).
- Significant technical decisions get an ADR in [docs/adr/](./docs/adr/).

## Reporting security issues

Do **not** open a public issue for vulnerabilities. Follow [SECURITY.md](./SECURITY.md).

## Code of Conduct

Participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
