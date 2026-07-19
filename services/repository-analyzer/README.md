# ProofForge Repository Analyzer

Read-only analysis of a local repository. Detects languages, frameworks, package
managers, databases, infrastructure, CI, tests, lint tools, entrypoints,
migrations, environment variables and dependencies, derives a coarse module and
architecture graph, and flags risk areas — emitting a structured
[`AnalysisReport`](src/proofforge_analyzer/models.py).

It never executes repository code; all findings come from parsing manifests and
scanning the directory tree. Running code is the job of the sandboxed Evidence
Engine (Phase 3).

## Usage

```bash
# from services/repository-analyzer
uv sync
uv run proofforge-analyzer /path/to/repo            # human summary
uv run proofforge-analyzer /path/to/repo --json     # full JSON report
uv run proofforge-analyzer /path/to/repo --output report.json
```

Exit codes: `0` analysis completed · `2` usage error (bad path).

## What it detects

| Category | Examples |
| --- | --- |
| Languages | TypeScript, JavaScript, Python, Go, Rust, Java, … (by extension) |
| Frameworks | Next.js, React, Express, Fastify, NestJS, FastAPI, Django, ORMs |
| Package managers | pnpm, npm, yarn, bun, pip, poetry, uv, cargo, go modules, … |
| Databases | PostgreSQL, MySQL, MongoDB, Redis, SQLite (from deps + compose) |
| Infrastructure | Docker, Docker Compose, Kubernetes, Helm, Terraform |
| CI | GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Jenkins |
| Tests / lint | Vitest, Jest, Playwright, pytest · ESLint, Prettier, Ruff, mypy |
| Structure | entrypoints, migrations, env vars, modules, dependency graph |
| Risk | large files, modules without tests, repositories without tests |

## Development

```bash
uv sync
uv run ruff check .
uv run mypy
uv run pytest
```

The analyzer is intentionally conservative: it reports what a repository
*declares*, keeping output stable and explainable for the Risk and Policy engines
that consume it downstream.
