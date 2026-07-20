"""Orchestration: run collectors, consolidate evidence, build and persist a bundle.

The engine depends on a :class:`Toolchain` abstraction, so the full parse and
consolidation path is exercised in tests with recorded tool output — no tools or
sandbox required — while production uses the host/sandbox-backed toolchain.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel

from proofforge_evidence import changed_coverage
from proofforge_evidence.collectors import parsers
from proofforge_evidence.context import Artifact, ChangeContext
from proofforge_evidence.manifest_builder import build_manifest
from proofforge_evidence.models import CollectorRun, ConsolidatedEvidence


class RawOutput(BaseModel):
    """The raw result of invoking one tool."""

    text: str | None = None
    status: str = "unavailable"  # "ok" | "unavailable" | "error" | "timeout"
    detail: str = ""
    duration_ms: int = 0


class Toolchain(Protocol):
    """Produces raw tool output for a repository. Implementations decide whether a
    tool runs on the host (static scanners) or in a sandbox (code execution)."""

    def run_tests(self, repo: Path) -> tuple[RawOutput, RawOutput]:
        """Return (JUnit XML, Cobertura XML) outputs."""

    def scan_secrets(self, repo: Path) -> RawOutput: ...
    def scan_sast(self, repo: Path) -> RawOutput: ...
    def scan_vulnerabilities(self, repo: Path) -> RawOutput: ...
    def generate_sbom(self, repo: Path) -> RawOutput: ...


class EngineResult(BaseModel):
    manifest: dict[str, object]
    bundle_dir: str
    evidence: ConsolidatedEvidence


class EvidenceEngine:
    def __init__(self, toolchain: Toolchain, *, container_image: str = "") -> None:
        self._toolchain = toolchain
        self._image = container_image

    def run(self, repo: Path, context: ChangeContext, bundle_dir: Path) -> EngineResult:
        repo = repo.resolve()
        artifacts_dir = bundle_dir / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        # Raw reports (e.g. Gitleaks) can contain matched secret values, and the
        # default output directory lives inside the repository. Drop a catch-all
        # .gitignore so a bundle is never committed by accident.
        gitignore = bundle_dir / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text("*\n", encoding="utf-8")

        evidence = ConsolidatedEvidence()
        artifacts: list[Artifact] = []

        self._collect_tests(repo, context, evidence, artifacts, artifacts_dir)
        self._collect_secrets(repo, evidence, artifacts, artifacts_dir)
        self._collect_sast(repo, evidence, artifacts, artifacts_dir)
        self._collect_vulnerabilities(repo, evidence, artifacts, artifacts_dir)
        self._collect_sbom(repo, evidence, artifacts, artifacts_dir)

        manifest = build_manifest(context, evidence, artifacts, container_image=self._image)

        (bundle_dir / "proof-manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (bundle_dir / "evidence.json").write_text(
            evidence.model_dump_json(indent=2) + "\n", encoding="utf-8"
        )

        return EngineResult(manifest=manifest, bundle_dir=str(bundle_dir), evidence=evidence)

    # ── individual collectors ───────────────────────────────────────────────

    def _collect_tests(
        self,
        repo: Path,
        context: ChangeContext,
        evidence: ConsolidatedEvidence,
        artifacts: list[Artifact],
        out: Path,
    ) -> None:
        junit, coverage = self._toolchain.run_tests(repo)
        run = CollectorRun(name="tests", status=junit.status, detail=junit.detail,
                           duration_ms=junit.duration_ms)

        if junit.status == "ok" and junit.text is not None:
            try:
                test_ev = parsers.parse_junit_xml(junit.text)
            except parsers.ParseError as err:
                run.status, run.detail = "error", str(err)
            else:
                evidence.tests = test_ev
                artifacts.append(self._persist("junit-report.xml", "junit", junit.text, out))

        # Coverage gets its own provenance entry. Folding it into the tests run
        # would leave a policy unable to tell "0% coverage" from "no coverage
        # report", and it would fail a repository for a measurement we never took.
        coverage_run = CollectorRun(
            name="coverage",
            status=coverage.status,
            detail=coverage.detail,
            duration_ms=coverage.duration_ms,
        )

        if coverage.status == "ok" and coverage.text is not None:
            try:
                total = parsers.parse_cobertura_line_rate(coverage.text)
            except parsers.ParseError as err:
                coverage_run.status, coverage_run.detail = "error", str(err)
            else:
                evidence.tests.coverage_total = total
                evidence.tests.coverage_collected = True
                artifacts.append(self._persist("coverage.xml", "coverage", coverage.text, out))

        evidence.runs.append(run)
        evidence.runs.append(coverage_run)
        self._collect_changed_coverage(repo, context, coverage, evidence)

    def _collect_changed_coverage(
        self,
        repo: Path,
        context: ChangeContext,
        coverage: RawOutput,
        evidence: ConsolidatedEvidence,
    ) -> None:
        """Coverage over the added lines, recorded with its own provenance.

        Separate from the coverage collector because they fail independently: a
        report can exist while the diff cannot be read, and the answer then is
        "unknown", not the repository total. Feeding the total into this field
        would let a policy approve a change on the strength of tests written for
        code it never touched.
        """

        if coverage.status != "ok" or coverage.text is None:
            result = changed_coverage.unavailable("no coverage report to measure against")
        else:
            result = changed_coverage.compute(
                repo, context.base_commit, context.commit, coverage.text
            )

        if result.percentage is not None:
            evidence.tests.coverage_changed = result.percentage
            evidence.tests.coverage_changed_measured = True

        evidence.runs.append(
            CollectorRun(
                name="changed-coverage",
                status="ok" if result.measured else "unavailable",
                detail=result.detail
                or f"{result.covered_lines}/{result.measured_lines} added lines covered",
            )
        )

    def _collect_secrets(
        self, repo: Path, evidence: ConsolidatedEvidence, artifacts: list[Artifact], out: Path
    ) -> None:
        raw = self._toolchain.scan_secrets(repo)
        run = self._run_record("secrets", raw)
        if raw.status == "ok" and raw.text is not None:
            try:
                evidence.security.secrets_detected = parsers.parse_gitleaks(raw.text)
            except parsers.ParseError as err:
                run.status, run.detail = "error", str(err)
            else:
                artifacts.append(self._persist("gitleaks.json", "secrets", raw.text, out))
        evidence.runs.append(run)

    def _collect_sast(
        self, repo: Path, evidence: ConsolidatedEvidence, artifacts: list[Artifact], out: Path
    ) -> None:
        raw = self._toolchain.scan_sast(repo)
        run = self._run_record("sast", raw)
        if raw.status == "ok" and raw.text is not None:
            try:
                evidence.security.sast = parsers.parse_semgrep(raw.text)
            except parsers.ParseError as err:
                run.status, run.detail = "error", str(err)
            else:
                artifacts.append(self._persist("semgrep.json", "sast", raw.text, out))
        evidence.runs.append(run)

    def _collect_vulnerabilities(
        self, repo: Path, evidence: ConsolidatedEvidence, artifacts: list[Artifact], out: Path
    ) -> None:
        raw = self._toolchain.scan_vulnerabilities(repo)
        run = self._run_record("vulnerabilities", raw)
        if raw.status == "ok" and raw.text is not None:
            try:
                evidence.security.vulnerabilities = parsers.parse_trivy(raw.text)
            except parsers.ParseError as err:
                run.status, run.detail = "error", str(err)
            else:
                artifacts.append(self._persist("trivy.json", "vulnerabilities", raw.text, out))
        evidence.runs.append(run)

    def _collect_sbom(
        self, repo: Path, evidence: ConsolidatedEvidence, artifacts: list[Artifact], out: Path
    ) -> None:
        raw = self._toolchain.generate_sbom(repo)
        run = self._run_record("sbom", raw)
        if raw.status == "ok" and raw.text is not None:
            try:
                components = parsers.parse_syft_component_count(raw.text)
            except parsers.ParseError as err:
                run.status, run.detail = "error", str(err)
            else:
                evidence.security.sbom_generated = True
                evidence.security.sbom_components = components
                artifacts.append(self._persist("sbom.json", "sbom", raw.text, out))
        evidence.runs.append(run)

    # ── helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _run_record(name: str, raw: RawOutput) -> CollectorRun:
        return CollectorRun(name=name, status=raw.status, detail=raw.detail,
                            duration_ms=raw.duration_ms)

    @staticmethod
    def _persist(filename: str, artifact_type: str, text: str, out: Path) -> Artifact:
        path = out / filename
        path.write_text(text, encoding="utf-8")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return Artifact(
            name=filename,
            type=artifact_type,
            path=f"artifacts/{filename}",
            sha256=f"sha256:{digest}",
        )
