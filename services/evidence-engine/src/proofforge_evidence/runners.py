"""Choosing how to run a repository's tests inside the sandbox.

Producing JUnit and Cobertura from an arbitrary repository is not universal: the
runner has to emit them, and not every framework can without extra packages. So
this module supports the frameworks whose reporters are built in, and says plainly
when a repository is not one of them. Reporting "unsupported" is a fact the
manifest can carry; guessing a command and misreading its failure is not.

Supported today:
  * pytest  — ``--junitxml`` is built in; coverage needs pytest-cov.
  * vitest  — the junit reporter is built in; coverage needs @vitest/coverage-v8.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

#: Where the sandbox writes reports. Mounted read-write; everything else is not.
OUTPUT_DIR = "/out"
JUNIT_PATH = f"{OUTPUT_DIR}/junit.xml"
COVERAGE_PATH = f"{OUTPUT_DIR}/coverage.xml"
BENCHMARK_PATH = f"{OUTPUT_DIR}/benchmarks.json"

#: The repository is mounted read-only and copied here, because installing
#: dependencies and running tests both write all over the working tree.
SOURCE_MOUNT = "/src"
WORK_DIR = "/work"


@dataclass(frozen=True)
class RunnerPlan:
    """Everything needed to run one repository's tests in a container."""

    stack: str
    image: str
    #: Single shell script: copy the source, install, then test.
    script: str


class UnsupportedStackError(Exception):
    """Raised when no runner can honestly claim to test this repository."""


def detect_stack(repo: Path) -> str:
    """Identify the test stack, or raise :class:`UnsupportedStackError`."""

    if (repo / "pyproject.toml").exists() or (repo / "requirements.txt").exists():
        if _has_pytest(repo):
            return "pytest"
        raise UnsupportedStackError("Python project without pytest")

    package_json = repo / "package.json"
    if package_json.exists():
        if _has_dependency(package_json, "vitest"):
            return "vitest"
        raise UnsupportedStackError(
            "Node project without vitest (jest needs the separate jest-junit reporter)"
        )

    raise UnsupportedStackError("no recognised test stack")


def plan_for(stack: str) -> RunnerPlan:
    if stack == "pytest":
        # The container root is read-only, so nothing may be installed into the
        # system site-packages. A virtualenv on the writable working volume gets
        # the project's dependencies; --system-site-packages keeps pytest and
        # pytest-cov from the image rather than downloading them again.
        return RunnerPlan(
            stack=stack,
            image="ghcr.io/proofforge/sandbox-python:3.12",
            script=_script(
                install="python -m venv --system-site-packages .venv; "
                ". .venv/bin/activate; "
                "if [ -f uv.lock ]; then uv sync --frozen --active; "
                "elif [ -f requirements.txt ]; then "
                "pip install --no-cache-dir -r requirements.txt; "
                "else pip install --no-cache-dir -e .; fi",
                # Run through the venv's interpreter, not the activated shell:
                # activating does not rebind a console script already installed
                # system-wide, so `pytest` would run under the system interpreter
                # and never see the project we just installed.
                test=f".venv/bin/python -m pytest --junitxml={JUNIT_PATH} "
                f"--cov --cov-report=xml:{COVERAGE_PATH} || true",
            ),
        )

    if stack == "vitest":
        return RunnerPlan(
            stack=stack,
            image="ghcr.io/proofforge/sandbox-node:20",
            script=_script(
                install="if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; "
                "elif [ -f package-lock.json ]; then npm ci; else npm install; fi",
                # Coverage is written inside the working volume, then copied
                # out. Pointing vitest at the output mount directly fails: its
                # coverage provider clears the reports directory first, and
                # rmdir on a mount point under a read-only root is EROFS — which
                # takes the whole run down, not just coverage. The copy also
                # renames cobertura's own filename to the one the engine reads.
                test=f"npx vitest run --reporter=junit --outputFile={JUNIT_PATH} "
                f"--coverage --coverage.reporter=cobertura "
                f"--coverage.reportsDirectory={WORK_DIR}/coverage || true; "
                f"cp {WORK_DIR}/coverage/cobertura-coverage.xml {COVERAGE_PATH} 2>/dev/null "
                f"|| true",
            ),
        )

    raise UnsupportedStackError(f"no runner for stack: {stack}")


def benchmark_plan_for(repo: Path) -> RunnerPlan:
    """How to run this repository's benchmarks, or raise.

    Only pytest-benchmark: its JSON is documented, and a tool whose output we
    guessed at would yield regression percentages that look measured.
    """

    if not _has_pytest_benchmark(repo):
        raise UnsupportedStackError(
            "no pytest-benchmark suite found; it is the only benchmark format read"
        )

    return RunnerPlan(
        stack="pytest-benchmark",
        image="ghcr.io/proofforge/sandbox-python:3.12",
        script=_script(
            install="python -m venv --system-site-packages .venv; "
            ". .venv/bin/activate; "
            "if [ -f uv.lock ]; then uv sync --frozen --active; "
            "elif [ -f requirements.txt ]; then "
            "pip install --no-cache-dir -r requirements.txt; "
            "else pip install --no-cache-dir -e .; fi; "
            "pip install --no-cache-dir pytest-benchmark",
            # `--benchmark-only` skips the ordinary tests: they already ran, and
            # running them again here would double the cost for no evidence.
            test=f".venv/bin/python -m pytest --benchmark-only "
            f"--benchmark-json={BENCHMARK_PATH} || true",
        ),
    )


def _has_pytest_benchmark(repo: Path) -> bool:
    for name in ("pyproject.toml", "requirements.txt", "tox.ini"):
        path = repo / name
        if path.exists() and "pytest-benchmark" in _read(path):
            return True
    return False


def _script(install: str, test: str) -> str:
    # HOME points at the writable volume because package managers insist on a
    # home for caches and config, and the container root is read-only.
    #
    # `|| true` on the test step is deliberate: a failing suite is evidence, not a
    # runner error. We want the reports either way, and the parser decides.
    return (
        f"set -e; cp -a {SOURCE_MOUNT}/. {WORK_DIR}/; cd {WORK_DIR}; "
        f"export HOME={WORK_DIR}; export UV_CACHE_DIR={WORK_DIR}/.uv-cache; "
        f"export NPM_CONFIG_CACHE={WORK_DIR}/.npm; "
        f"{install}; {test}"
    )


def _has_pytest(repo: Path) -> bool:
    for name in ("pyproject.toml", "requirements.txt", "tox.ini", "pytest.ini"):
        path = repo / name
        if path.exists() and "pytest" in _read(path):
            return True
    return (repo / "tests").is_dir() or (repo / "test").is_dir()


def _has_dependency(package_json: Path, name: str) -> bool:
    try:
        data = json.loads(package_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(data, dict):
        return False
    for field in ("dependencies", "devDependencies"):
        section = data.get(field)
        if isinstance(section, dict) and name in section:
            return True
    return False


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""
