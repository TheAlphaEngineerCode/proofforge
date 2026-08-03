"""Host/sandbox-backed toolchain.

Static scanners (Gitleaks, Semgrep, Trivy, Syft) only read files, so they run on
the host when installed. Test execution runs repository code and therefore only
happens inside the sandbox — never on the host. When a tool or the sandbox is
unavailable the toolchain reports it cleanly instead of failing the whole run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Protocol

from proofforge_evidence import runners
from proofforge_evidence.engine import RawOutput
from proofforge_evidence.sandbox import (
    DockerSandbox,
    Mount,
    SandboxResult,
    SandboxSpec,
    docker_available,
)


class Sandbox(Protocol):
    """Runs a spec to completion. Injectable so the wiring is testable without Docker."""

    def run(self, spec: SandboxSpec) -> SandboxResult: ...


def _unavailable(detail: str, status: str = "unavailable") -> RawOutput:
    return RawOutput(status=status, detail=detail)


def _both_unavailable(detail: str, status: str = "unavailable") -> tuple[RawOutput, RawOutput]:
    return _unavailable(detail, status), _unavailable(detail, status)


def _read_report(path: Path) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    return text if text.strip() else None


def _reports_dir(scratch: str) -> Path:
    """A directory inside `scratch` that the sandbox can write its reports into.

    The sandbox runs as uid 10001 and that is not negotiable — it is the whole
    point of running someone else's tests in a container. `mkdtemp` creates its
    directory as 0700 owned by whoever started the engine, so the two never match
    on a real host and the run ends with `Permission denied` on junit.xml *after*
    the tests have already passed. The collector then reports "no JUnit report
    produced", which reads as a repository whose tests could not run rather than
    as a directory the reports could not be written to.

    Hence a mode the container's user can write. It goes on a directory *nested*
    inside the `mkdtemp` one rather than on that directory itself, and the nesting
    is the security boundary rather than a tidiness preference: a world-writable
    directory that anyone on the host can reach is somewhere a second local
    account could swap junit.xml between the container writing it and the engine
    reading it, which is evidence tampering in the one tool that must not permit
    it. The 0700 parent means nobody but us can walk in; the container never walks
    in either, since the daemon mounts the directory by inode.
    """

    reports = Path(scratch) / "reports"
    reports.mkdir()
    reports.chmod(0o777)
    return reports


def _why_it_failed(stderr: str, limit: int = 300) -> str:
    """The last `limit` characters of stderr — where the reason actually is.

    Taking the first characters instead reports whatever the tool said when it
    started, and a tool that has to fetch something says a lot: the first run of
    the sandbox in CI reported `Unable to find image ... locally` followed by
    layer-pull progress as the cause of a failure that happened long afterwards.
    Diagnosing from that is diagnosing from the wrong end of the output, and a
    manifest that names a confident wrong cause is worse than one that says
    nothing.
    """

    text = stderr.strip()
    return text if len(text) <= limit else f"…{text[-limit:]}"


_DEFAULT_TIMEOUT_S = 300

#: Overrides the per-tool timeout, in seconds.
TIMEOUT_ENV = "PROOFFORGE_TOOL_TIMEOUT_S"


def default_timeout_s() -> int:
    """The per-tool timeout, overridable by the environment.

    Five minutes is a reasonable default and a bad ceiling. It covers a scanner
    on a small repository, but the test collector spends that budget installing
    dependencies before a single test runs, and on a monorepo the install alone
    can outlast it — which is reported as ``timeout``, honestly but uselessly,
    with no way to say "this repository needs longer". A value that is not a
    positive integer is ignored rather than obeyed: a timeout of zero would make
    every collector fail instantly and read as a repository with nothing to
    measure, which is the one misreading this project cannot allow.
    """

    raw = os.environ.get(TIMEOUT_ENV, "").strip()
    if not raw:
        return _DEFAULT_TIMEOUT_S
    try:
        seconds = int(raw)
    except ValueError:
        return _DEFAULT_TIMEOUT_S
    return seconds if seconds > 0 else _DEFAULT_TIMEOUT_S


class HostToolchain:
    """Runs static scanners on the host; delegates test execution to the sandbox."""

    def __init__(
        self,
        *,
        timeout_s: int | None = None,
        sandbox: Sandbox | None = None,
    ) -> None:
        self._timeout = default_timeout_s() if timeout_s is None else timeout_s
        self._sandbox: Sandbox = sandbox if sandbox is not None else DockerSandbox()
        self._observed_image = ""

    def observed_image(self) -> str:
        """The image repository code actually ran in, or "" if none ever did.

        Empty is the honest answer when the sandbox never started — no Docker, no
        supported runner, nothing to name. The manifest carries it as-is rather
        than inventing a plausible tag.
        """

        return self._observed_image

    def run_tests(self, repo: Path) -> tuple[RawOutput, RawOutput]:
        """Run the repository's tests in a container and collect the reports.

        Repository code is untrusted and never runs on the host: if the sandbox is
        unavailable we report that and collect nothing.
        """
        if not docker_available():
            return _both_unavailable("Docker unavailable; test code never runs on the host")

        try:
            plan = runners.plan_for(runners.detect_stack(repo))
        except runners.UnsupportedStackError as err:
            return _both_unavailable(f"no supported test runner: {err}")

        with tempfile.TemporaryDirectory() as scratch:
            out = _reports_dir(scratch)
            spec = SandboxSpec(
                image=plan.image,
                command=[plan.script],
                workdir=runners.WORK_DIR,
                timeout_s=self._timeout,
                # Dependency installation needs the network, so this is the one
                # place the default network-off stance is relaxed. Everything else
                # still holds: non-root, dropped capabilities, no new privileges,
                # read-only root, CPU/memory/PID caps, and an ephemeral container.
                network=True,
                mounts=[
                    Mount(host=repo, container=runners.SOURCE_MOUNT, read_only=True),
                    Mount(host=out, container=runners.OUTPUT_DIR, read_only=False),
                ],
                writable_volumes=[runners.WORK_DIR],
            )

            result = self._sandbox.run(spec)
            # First run that actually started wins, and the test run goes first —
            # so a benchmark in a different image cannot rewrite what the manifest
            # says the tests ran in.
            self._observed_image = self._observed_image or result.image
            if result.timed_out:
                return _both_unavailable(f"test run timed out after {self._timeout}s", "timeout")

            junit = _read_report(out / "junit.xml")
            coverage = _read_report(out / "coverage.xml")

        if junit is None:
            detail = _why_it_failed(result.stderr) or f"runner exited {result.exit_code}"
            return (
                RawOutput(status="error", detail=f"no JUnit report produced: {detail}"),
                _unavailable("no coverage report produced"),
            )

        return (
            RawOutput(status="ok", text=junit, duration_ms=result.duration_ms),
            RawOutput(status="ok", text=coverage, duration_ms=result.duration_ms)
            if coverage is not None
            else _unavailable("the run produced no coverage report"),
        )

    def run_benchmarks(self, repo: Path) -> RawOutput:
        """Run the repository's benchmarks in the sandbox and return the report.

        Same containment as the test run: benchmark code is repository code, so
        it executes in a container or not at all.
        """

        if not docker_available():
            return _unavailable("Docker unavailable; benchmark code never runs on the host")

        try:
            plan = runners.benchmark_plan_for(repo)
        except runners.UnsupportedStackError as err:
            return _unavailable(str(err))

        with tempfile.TemporaryDirectory() as scratch:
            out = _reports_dir(scratch)
            spec = SandboxSpec(
                image=plan.image,
                command=[plan.script],
                workdir=runners.WORK_DIR,
                timeout_s=self._timeout,
                network=True,
                mounts=[
                    Mount(host=repo, container=runners.SOURCE_MOUNT, read_only=True),
                    Mount(host=out, container=runners.OUTPUT_DIR, read_only=False),
                ],
                writable_volumes=[runners.WORK_DIR],
            )

            result = self._sandbox.run(spec)
            self._observed_image = self._observed_image or result.image
            if result.timed_out:
                return _unavailable(f"benchmarks timed out after {self._timeout}s", "timeout")

            report = _read_report(out / "benchmarks.json")

        if report is None:
            detail = _why_it_failed(result.stderr) or f"runner exited {result.exit_code}"
            return RawOutput(status="error", detail=f"no benchmark report produced: {detail}")
        return RawOutput(status="ok", text=report, duration_ms=result.duration_ms)

    def scan_secrets(self, repo: Path) -> RawOutput:
        if shutil.which("gitleaks") is None:
            return RawOutput(status="unavailable", detail="gitleaks not installed")
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "gitleaks.json"
            result = self._run(
                [
                    "gitleaks",
                    "detect",
                    "--no-banner",
                    "--report-format",
                    "json",
                    "--report-path",
                    str(report),
                    "--source",
                    str(repo),
                ]
            )
            if result.status == "ok":
                # gitleaks writes findings to the report file (empty array if none).
                text = report.read_text(encoding="utf-8") if report.exists() else "[]"
                return RawOutput(status="ok", text=text, duration_ms=result.duration_ms)
            return result

    def scan_sast(self, repo: Path) -> RawOutput:
        if shutil.which("semgrep") is None:
            return RawOutput(status="unavailable", detail="semgrep not installed")
        return self._run(["semgrep", "--config", "auto", "--json", "--quiet", str(repo)])

    def scan_vulnerabilities(self, repo: Path) -> RawOutput:
        if shutil.which("trivy") is None:
            return RawOutput(status="unavailable", detail="trivy not installed")
        return self._run(["trivy", "fs", "--quiet", "--format", "json", str(repo)])

    def generate_sbom(self, repo: Path) -> RawOutput:
        if shutil.which("syft") is None:
            return RawOutput(status="unavailable", detail="syft not installed")
        return self._run(["syft", str(repo), "-o", "syft-json"])

    def _run(self, command: list[str]) -> RawOutput:
        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return RawOutput(status="timeout", detail=f"timed out after {self._timeout}s")
        except OSError as err:
            return RawOutput(status="error", detail=str(err))

        duration = int((time.monotonic() - started) * 1000)
        # A non-zero exit is normal for scanners that found something; as long as
        # they produced output we treat the run as successful and let the parser
        # decide. Only a total absence of output on failure is an error.
        if completed.stdout.strip():
            return RawOutput(status="ok", text=completed.stdout, duration_ms=duration)
        if completed.returncode != 0:
            return RawOutput(
                status="error",
                detail=_why_it_failed(completed.stderr, 500) or f"exit code {completed.returncode}",
                duration_ms=duration,
            )
        return RawOutput(status="ok", text=completed.stdout, duration_ms=duration)
