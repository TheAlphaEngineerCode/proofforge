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

from proofforge_evidence.engine import RawOutput
from proofforge_evidence.sandbox import docker_available

_DEFAULT_TIMEOUT_S = 300


class HostToolchain:
    """Runs static scanners on the host; delegates test execution to the sandbox."""

    def __init__(self, *, timeout_s: int = _DEFAULT_TIMEOUT_S) -> None:
        self._timeout = timeout_s

    def run_tests(self, repo: Path) -> tuple[RawOutput, RawOutput]:
        # Tests execute untrusted repository code, so they must run in the sandbox.
        # We never fall back to the host. Wiring per-stack runner images is the
        # remaining Phase 3 integration step; until then this reports cleanly.
        if not docker_available():
            reason = "Docker unavailable; test code is never executed on the host"
        else:
            reason = "no sandbox runner image configured for the detected stack"
        unavailable = RawOutput(status="unavailable", detail=reason)
        return unavailable, unavailable

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
