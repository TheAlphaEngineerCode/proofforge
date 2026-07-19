"""Detection heuristics.

Each detector inspects the scanned file index and/or parsed manifests and returns
a small, well-typed result. Detectors are deliberately conservative: they report
what the repository *declares* rather than guessing, so the output stays stable
and explainable.
"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path
from typing import Any

from proofforge_analyzer.models import Dependency
from proofforge_analyzer.scanner import ScannedFile

# ── file readers ────────────────────────────────────────────────────────────


def read_text(root: Path, relpath: str) -> str | None:
    try:
        return (root / relpath).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def read_json(root: Path, relpath: str) -> dict[str, Any] | None:
    text = read_text(root, relpath)
    if text is None:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def read_toml(root: Path, relpath: str) -> dict[str, Any] | None:
    try:
        with (root / relpath).open("rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return None


# ── languages ───────────────────────────────────────────────────────────────

LANGUAGE_BY_EXTENSION: dict[str, str] = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".kt": "Kotlin",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".c": "C",
    ".h": "C",
    ".cpp": "C++",
    ".cc": "C++",
    ".swift": "Swift",
    ".scala": "Scala",
    ".sh": "Shell",
    ".sql": "SQL",
}


def _has(files: list[ScannedFile], name: str) -> bool:
    return any(f.name == name for f in files)


def _has_relpath(files: list[ScannedFile], relpath: str) -> bool:
    return any(f.relpath == relpath for f in files)


# ── manifest collection ─────────────────────────────────────────────────────


def package_json_paths(files: list[ScannedFile]) -> list[str]:
    return [f.relpath for f in files if f.name == "package.json"]


def collect_dependencies(root: Path, files: list[ScannedFile]) -> list[Dependency]:
    """Collect declared dependencies from every JS and Python manifest found."""

    deps: list[Dependency] = []
    seen: set[tuple[str, str]] = set()

    def add(name: str, version: str, ecosystem: str, *, dev: bool) -> None:
        key = (ecosystem, name)
        if key in seen:
            return
        seen.add(key)
        deps.append(Dependency(name=name, version=version, ecosystem=ecosystem, dev=dev))

    for relpath in package_json_paths(files):
        pkg = read_json(root, relpath)
        if pkg is None:
            continue
        for field, dev in (("dependencies", False), ("devDependencies", True)):
            section = pkg.get(field)
            if isinstance(section, dict):
                for name, version in section.items():
                    add(str(name), str(version), "npm", dev=dev)

    pyproject = read_toml(root, "pyproject.toml")
    if pyproject is not None:
        project = pyproject.get("project", {})
        if isinstance(project, dict):
            for spec in project.get("dependencies", []) or []:
                name, version = _split_pep508(str(spec))
                add(name, version, "pypi", dev=False)
        # PEP 735 dependency groups and legacy poetry groups both hold dev deps.
        groups = pyproject.get("dependency-groups", {})
        if isinstance(groups, dict):
            for specs in groups.values():
                for spec in specs or []:
                    name, version = _split_pep508(str(spec))
                    add(name, version, "pypi", dev=True)

    requirements = read_text(root, "requirements.txt")
    if requirements is not None:
        for line in requirements.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                name, version = _split_pep508(stripped)
                add(name, version, "pypi", dev=False)

    return deps


_PEP508_NAME = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def _split_pep508(spec: str) -> tuple[str, str]:
    """Split a PEP 508 / requirements line into (name, version-spec).

    The name is the leading run of valid distribution-name characters; anything
    after it (extras, version constraints, markers) is treated as the version
    spec. This stays correct for compound specs like ``pkg<2,>=1``.
    """

    match = _PEP508_NAME.match(spec)
    if match is None:
        return spec.strip(), "*"
    name = match.group(1)
    remainder = spec[match.end() :].strip()
    if remainder.startswith("["):  # drop extras: "fastapi[all]>=0.1" -> version part only
        _, _, remainder = remainder.partition("]")
        remainder = remainder.strip()
    return name, remainder or "*"


def _dependency_names(deps: list[Dependency]) -> set[str]:
    return {d.name.lower() for d in deps}


# ── package managers ────────────────────────────────────────────────────────


def detect_package_managers(root: Path, files: list[ScannedFile]) -> list[str]:
    managers: set[str] = set()

    lockfiles = {
        "pnpm-lock.yaml": "pnpm",
        "yarn.lock": "yarn",
        "package-lock.json": "npm",
        "bun.lockb": "bun",
        "poetry.lock": "poetry",
        "uv.lock": "uv",
        "Pipfile.lock": "pipenv",
        "Cargo.lock": "cargo",
        "go.sum": "go modules",
        "composer.lock": "composer",
    }
    for name, manager in lockfiles.items():
        if _has(files, name):
            managers.add(manager)

    if _has(files, "package.json") and not (managers & {"pnpm", "yarn", "npm", "bun"}):
        managers.add("npm")
    if _has(files, "go.mod"):
        managers.add("go modules")
    if _has(files, "Cargo.toml"):
        managers.add("cargo")
    if _has(files, "Gemfile"):
        managers.add("bundler")
    if _has(files, "requirements.txt"):
        managers.add("pip")
    if _has(files, "pom.xml"):
        managers.add("maven")
    if _has(files, "build.gradle") or _has(files, "build.gradle.kts"):
        managers.add("gradle")

    pyproject = read_toml(root, "pyproject.toml")
    if pyproject is not None:
        tools = pyproject.get("tool", {})
        tools = tools if isinstance(tools, dict) else {}
        if "poetry" in tools:
            managers.add("poetry")
        if "pdm" in tools:
            managers.add("pdm")
        if "hatch" in tools or _build_backend_contains(pyproject, "hatchling"):
            managers.add("hatch")
        if not (managers & {"poetry", "pdm", "hatch", "uv", "pip"}):
            managers.add("pip")

    return sorted(managers)


def _build_backend_contains(pyproject: dict[str, Any], needle: str) -> bool:
    build_system = pyproject.get("build-system", {})
    if not isinstance(build_system, dict):
        return False
    backend = str(build_system.get("build-backend", ""))
    return needle in backend


# ── frameworks / databases ──────────────────────────────────────────────────

FRAMEWORK_SIGNATURES: dict[str, str] = {
    "next": "Next.js",
    "react": "React",
    "react-dom": "React",
    "vue": "Vue",
    "@angular/core": "Angular",
    "svelte": "Svelte",
    "astro": "Astro",
    "@remix-run/react": "Remix",
    "express": "Express",
    "fastify": "Fastify",
    "@nestjs/core": "NestJS",
    "koa": "Koa",
    "prisma": "Prisma (ORM)",
    "@prisma/client": "Prisma (ORM)",
    "drizzle-orm": "Drizzle (ORM)",
    "typeorm": "TypeORM (ORM)",
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "starlette": "Starlette",
    "aiohttp": "aiohttp",
    "sqlalchemy": "SQLAlchemy (ORM)",
}

DATABASE_SIGNATURES: dict[str, str] = {
    "pg": "PostgreSQL",
    "postgres": "PostgreSQL",
    "psycopg": "PostgreSQL",
    "psycopg2": "PostgreSQL",
    "psycopg2-binary": "PostgreSQL",
    "asyncpg": "PostgreSQL",
    "mysql": "MySQL",
    "mysql2": "MySQL",
    "pymysql": "MySQL",
    "mongodb": "MongoDB",
    "mongoose": "MongoDB",
    "pymongo": "MongoDB",
    "redis": "Redis",
    "ioredis": "Redis",
    "sqlite3": "SQLite",
    "better-sqlite3": "SQLite",
}

# Docker image name fragments → database.
DATABASE_IMAGE_SIGNATURES: dict[str, str] = {
    "postgres": "PostgreSQL",
    "mysql": "MySQL",
    "mariadb": "MySQL",
    "mongo": "MongoDB",
    "redis": "Redis",
    "cockroach": "CockroachDB",
}


def detect_frameworks(deps: list[Dependency]) -> list[str]:
    names = _dependency_names(deps)
    found = {label for dep, label in FRAMEWORK_SIGNATURES.items() if dep in names}
    return sorted(found)


def detect_databases(root: Path, files: list[ScannedFile], deps: list[Dependency]) -> list[str]:
    names = _dependency_names(deps)
    found = {label for dep, label in DATABASE_SIGNATURES.items() if dep in names}

    for relpath in _compose_files(files):
        text = read_text(root, relpath) or ""
        lowered = text.lower()
        for fragment, label in DATABASE_IMAGE_SIGNATURES.items():
            if f"image: {fragment}" in lowered or f"image: docker.io/{fragment}" in lowered:
                found.add(label)

    return sorted(found)


def _compose_files(files: list[ScannedFile]) -> list[str]:
    return [
        f.relpath
        for f in files
        if f.name in {"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}
    ]


# ── infrastructure / CI / tests / lint ──────────────────────────────────────


def detect_infrastructure(files: list[ScannedFile]) -> list[str]:
    infra: set[str] = set()
    for f in files:
        if f.name == "Dockerfile" or f.name.startswith("Dockerfile."):
            infra.add("Docker")
        if f.name in {"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}:
            infra.add("Docker Compose")
        if f.extension == ".tf":
            infra.add("Terraform")
        if f.name == "Chart.yaml":
            infra.add("Helm")
        parts = f.relpath.split("/")
        if "kubernetes" in parts or "k8s" in parts:
            infra.add("Kubernetes")
    return sorted(infra)


def detect_ci(files: list[ScannedFile]) -> list[str]:
    ci: set[str] = set()
    for f in files:
        if f.relpath.startswith(".github/workflows/") and f.extension in {".yml", ".yaml"}:
            ci.add("GitHub Actions")
        if f.name == ".gitlab-ci.yml":
            ci.add("GitLab CI")
        if f.relpath.startswith(".circleci/"):
            ci.add("CircleCI")
        if f.name in {"azure-pipelines.yml", "azure-pipelines.yaml"}:
            ci.add("Azure Pipelines")
        if f.name == "Jenkinsfile":
            ci.add("Jenkins")
    return sorted(ci)


def detect_test_frameworks(
    root: Path, files: list[ScannedFile], deps: list[Dependency]
) -> list[str]:
    names = _dependency_names(deps)
    dep_frameworks = {
        "vitest": "Vitest",
        "jest": "Jest",
        "mocha": "Mocha",
        "@playwright/test": "Playwright",
        "cypress": "Cypress",
        "pytest": "pytest",
    }
    found = {label for dep, label in dep_frameworks.items() if dep in names}

    if _has(files, "pytest.ini") or _pyproject_has_tool(root, "pytest"):
        found.add("pytest")
    if any(f.name.startswith("vitest.config.") for f in files):
        found.add("Vitest")
    if any(f.name.startswith("jest.config.") for f in files):
        found.add("Jest")
    return sorted(found)


def detect_lint_tools(
    root: Path, files: list[ScannedFile], deps: list[Dependency] | None = None
) -> list[str]:
    tools: set[str] = set()
    names = _dependency_names(deps) if deps else set()
    if "eslint" in names:
        tools.add("ESLint")
    if "prettier" in names:
        tools.add("Prettier")
    for f in files:
        if f.name.startswith(".eslintrc") or f.name.startswith("eslint.config."):
            tools.add("ESLint")
        if f.name.startswith(".prettierrc") or f.name == "prettier.config.js":
            tools.add("Prettier")
        if f.name in {"ruff.toml", ".ruff.toml"}:
            tools.add("Ruff")
        if f.name == ".flake8":
            tools.add("Flake8")
        if f.name == "mypy.ini":
            tools.add("mypy")
        if f.name in {".golangci.yml", ".golangci.yaml"}:
            tools.add("golangci-lint")
    if _pyproject_has_tool(root, "ruff"):
        tools.add("Ruff")
    if _pyproject_has_tool(root, "mypy"):
        tools.add("mypy")
    if _pyproject_has_tool(root, "black"):
        tools.add("Black")
    return sorted(tools)


def _pyproject_has_tool(root: Path, tool: str) -> bool:
    pyproject = read_toml(root, "pyproject.toml")
    if pyproject is None:
        return False
    tools = pyproject.get("tool", {})
    return isinstance(tools, dict) and tool in tools


def detect_containers(files: list[ScannedFile]) -> list[str]:
    return sorted(
        f.relpath for f in files if f.name == "Dockerfile" or f.name.startswith("Dockerfile.")
    )


# ── entrypoints / migrations / env vars ─────────────────────────────────────

_COMMON_ENTRYPOINTS = (
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
    "src/main.ts",
    "src/main.py",
    "app/main.py",
    "main.py",
    "__main__.py",
    "manage.py",
    "main.go",
    "cmd/main.go",
)


def detect_entrypoints(root: Path, files: list[ScannedFile]) -> list[str]:
    entrypoints: set[str] = set()

    for relpath in package_json_paths(files):
        pkg = read_json(root, relpath)
        if pkg is None:
            continue
        prefix = relpath.rsplit("package.json", 1)[0]
        main = pkg.get("main")
        if isinstance(main, str):
            entrypoints.add(f"{prefix}{main}")
        bin_field = pkg.get("bin")
        if isinstance(bin_field, str):
            entrypoints.add(f"{prefix}{bin_field}")
        elif isinstance(bin_field, dict):
            for target in bin_field.values():
                if isinstance(target, str):
                    entrypoints.add(f"{prefix}{target}")

    for candidate in _COMMON_ENTRYPOINTS:
        if _has_relpath(files, candidate):
            entrypoints.add(candidate)

    return sorted(entrypoints)


def detect_migrations(files: list[ScannedFile]) -> list[str]:
    found: set[str] = set()
    for f in files:
        parts = f.relpath.split("/")
        if "migrations" in parts or "alembic" in parts:
            # record the migrations directory, not each file
            index = parts.index("migrations") if "migrations" in parts else parts.index("alembic")
            found.add("/".join(parts[: index + 1]))
        if f.name == "alembic.ini":
            found.add("alembic.ini")
    return sorted(found)


def detect_env_vars(root: Path, files: list[ScannedFile]) -> list[str]:
    env_files = [
        f.relpath
        for f in files
        if f.name in {".env.example", ".env.sample", ".env.template", ".env.dist"}
    ]
    keys: set[str] = set()
    for relpath in env_files:
        text = read_text(root, relpath) or ""
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key = stripped.split("=", 1)[0].strip()
            if key.startswith("export "):
                key = key[len("export ") :].strip()
            if key.isidentifier() or _looks_like_env_key(key):
                keys.add(key)
    return sorted(keys)


def _looks_like_env_key(key: str) -> bool:
    return bool(key) and all(c.isalnum() or c == "_" for c in key)
