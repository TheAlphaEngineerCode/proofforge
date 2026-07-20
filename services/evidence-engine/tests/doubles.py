"""Toolchain stand-ins for tests.

Every collector added to the engine widens the Toolchain protocol, and the
doubles lived in three test files — so each new collector broke all three and
the suite went red for a reason that had nothing to do with the change. One
place to widen instead.
"""

from __future__ import annotations

from pathlib import Path

from proofforge_evidence.engine import RawOutput


class NullToolchain:
    """Every tool unavailable.

    The base for tests about collectors that never touch the toolchain: if one
    of them does reach it, `unavailable` is the honest answer rather than a
    fabricated success.
    """

    def run_tests(self, repo: Path) -> tuple[RawOutput, RawOutput]:  # noqa: ARG002
        return RawOutput(status="unavailable"), RawOutput(status="unavailable")

    def run_benchmarks(self, repo: Path) -> RawOutput:  # noqa: ARG002
        return RawOutput(status="unavailable")

    def scan_secrets(self, repo: Path) -> RawOutput:  # noqa: ARG002
        return RawOutput(status="unavailable")

    def scan_sast(self, repo: Path) -> RawOutput:  # noqa: ARG002
        return RawOutput(status="unavailable")

    def scan_vulnerabilities(self, repo: Path) -> RawOutput:  # noqa: ARG002
        return RawOutput(status="unavailable")

    def generate_sbom(self, repo: Path) -> RawOutput:  # noqa: ARG002
        return RawOutput(status="unavailable")
