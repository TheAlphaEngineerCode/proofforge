"""Host/sandbox-backed toolchain.

Static scanners (Gitleaks, Semgrep, Trivy, Syft) only read files, so they run on
the host when installed. Test execution runs repository code and therefore only
happens inside the sandbox — never on the host. When a tool or the sandbox is
unavailable the toolchain reports it cleanly instead of failing the whole run.
"""

from __future__ import annotations

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

_DEFAULT_TIMEOUT_S = 300


class HostToolchain:
    """Runs static scanners on the host; delegates test execution to the sandbox."""

    def __init__(
        self,
        *,
        timeout_s: int = _DEFAULT_TIMEOUT_S,
        sandbox: Sandbox | None = None,
    ) -> None:
        self._timeout = timeout_s
        self._sandbox: Sandbox = sandbox if sandbox is not None else DockerSandbox()

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

        with tempfile.TemporaryDirectory() as out_dir:
            out = Path(out_dir)
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
            if result.timed_out:
                return _both_unavailable(f"test run timed out after {self._timeout}s", "timeout")

            junit = _read_report(out / "junit.xml")
            coverage = _read_report(out / "coverage.xml")

        if junit is None:
            detail = result.stderr.strip()[:300] or f"runner exited {result.exit_code}"
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
                detail=completed.stderr.strip()[:500] or f"exit code {completed.returncode}",
                duration_ms=duration,
            )
        return RawOutput(status="ok", text=completed.stdout, duration_ms=duration)
