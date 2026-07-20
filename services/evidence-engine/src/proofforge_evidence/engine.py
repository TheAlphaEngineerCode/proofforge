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

from proofforge_evidence import changed_coverage, diff, worktree
from proofforge_evidence.collectors import benchmarks, migrations, parsers, quality
from proofforge_evidence.context import Artifact, ChangeContext
from proofforge_evidence.manifest_builder import build_manifest
from proofforge_evidence.models import (
    CollectorRun,
    ConsolidatedEvidence,
    OperationsEvidence,
    PerformanceEntry,
)
from proofforge_evidence.signing import Signer


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

    def run_benchmarks(self, repo: Path) -> RawOutput:
        """Return a pytest-benchmark JSON report. Runs repository code, so sandboxed."""

    def scan_secrets(self, repo: Path) -> RawOutput: ...
    def scan_sast(self, repo: Path) -> RawOutput: ...
    def scan_vulnerabilities(self, repo: Path) -> RawOutput: ...
    def generate_sbom(self, repo: Path) -> RawOutput: ...


class EngineResult(BaseModel):
    manifest: dict[str, object]
    bundle_dir: str
    evidence: ConsolidatedEvidence


class EvidenceEngine:
    def __init__(
        self,
        toolchain: Toolchain,
        *,
        container_image: str = "",
        signer: Signer | None = None,
    ) -> None:
        self._toolchain = toolchain
        self._image = container_image
        self._signer = signer

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
        self._record_uncollected(evidence)
        self._collect_operations(repo, context, evidence)
        self._collect_quality(repo, context, evidence)
        self._collect_performance(repo, context, evidence)
        self._collect_secrets(repo, evidence, artifacts, artifacts_dir)
        self._collect_sast(repo, evidence, artifacts, artifacts_dir)
        self._collect_vulnerabilities(repo, evidence, artifacts, artifacts_dir)
        self._collect_sbom(repo, evidence, artifacts, artifacts_dir)

        manifest = build_manifest(
            context, evidence, artifacts, container_image=self._image, signer=self._signer
        )

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

    def _record_uncollected(self, evidence: ConsolidatedEvidence) -> None:
        """Declare the evidence nobody gathers yet.

        The manifest has fields for quality, performance and operations, and
        without a collector saying so their defaults read as measurements. The
        operations defaults are the dangerous ones: `migrationsReversible` and
        `rollbackAvailable` default to true, so a manifest asserted that
        migrations were safe when nothing had looked. The verdict consumes those
        fields, which meant a rule that appeared to guard against irreversible
        migrations could never fire.
        """



    def _collect_performance(
        self, repo: Path, context: ChangeContext, evidence: ConsolidatedEvidence
    ) -> None:
        """Benchmark the change against the commit it branched from.

        A regression is a comparison, so one run measures nothing: the suite runs
        on this checkout and again on a throwaway checkout of the base. If either
        side cannot be produced the collector says so, because a percentage from
        one measurement would be invented.
        """

        candidate_raw = self._toolchain.run_benchmarks(repo)
        if candidate_raw.status != "ok" or candidate_raw.text is None:
            evidence.runs.append(
                CollectorRun(
                    name="performance",
                    status=candidate_raw.status,
                    detail=candidate_raw.detail or "no benchmarks ran on the change",
                    duration_ms=candidate_raw.duration_ms,
                )
            )
            return

        with worktree.checkout(repo, context.base_commit) as base_tree:
            if base_tree is None:
                evidence.runs.append(
                    CollectorRun(
                        name="performance",
                        status="unavailable",
                        detail="the base commit could not be checked out, so there is no baseline",
                    )
                )
                return
            baseline_raw = self._toolchain.run_benchmarks(base_tree)

        if baseline_raw.status != "ok" or baseline_raw.text is None:
            evidence.runs.append(
                CollectorRun(
                    name="performance",
                    status="unavailable",
                    detail=f"the base commit produced no benchmarks: {baseline_raw.detail}",
                )
            )
            return

        try:
            baseline = benchmarks.parse_pytest_benchmark(baseline_raw.text)
            candidate = benchmarks.parse_pytest_benchmark(candidate_raw.text)
        except benchmarks.BenchmarkParseError as err:
            evidence.runs.append(
                CollectorRun(name="performance", status="error", detail=str(err))
            )
            return

        compared = benchmarks.compare(baseline, candidate)
        evidence.performance = [
            PerformanceEntry(
                name=item.name,
                baseline_ms=item.baseline_ms,
                candidate_ms=item.candidate_ms,
                regression_percentage=item.regression_percentage,
            )
            for item in compared.benchmarks
        ]
        evidence.runs.append(
            CollectorRun(
                name="performance",
                status="ok" if compared.measured else "unavailable",
                detail=compared.detail,
            )
        )

    def _collect_quality(
        self, repo: Path, context: ChangeContext, evidence: ConsolidatedEvidence
    ) -> None:
        """Complexity and duplication, reported as two collectors.

        They are separate because their footing differs: complexity is exact and
        Python-only, duplication is crude and applies to any text. One entry
        reading `quality: ok` would hide which of the two actually happened.
        """

        try:
            changed = sorted(diff.changed_lines(repo, context.base_commit, context.commit))
        except diff.DiffUnavailableError as err:
            for name in ("complexity", "duplication"):
                evidence.runs.append(
                    CollectorRun(
                        name=name,
                        status="unavailable",
                        detail=f"could not read the diff: {err}",
                    )
                )
            return

        complexity = quality.measure_complexity(repo, changed, context.base_commit)
        if complexity.measured:
            evidence.quality.complexity_before = complexity.before
            evidence.quality.complexity_after = complexity.after
        evidence.runs.append(
            CollectorRun(
                name="complexity",
                status="ok" if complexity.measured else "unavailable",
                detail=complexity.detail,
            )
        )

        duplication = quality.measure_duplication(repo, changed)
        if duplication.measured:
            evidence.quality.duplicated_lines_percentage = duplication.percentage
        evidence.runs.append(
            CollectorRun(
                name="duplication",
                status="ok" if duplication.measured else "unavailable",
                detail=duplication.detail,
            )
        )

    def _collect_operations(
        self, repo: Path, context: ChangeContext, evidence: ConsolidatedEvidence
    ) -> None:
        """Read the migrations a change touches.

        Needs the diff, so it fails the same way coverage does when the base
        commit is missing: unavailable, with the reason. Reporting no migrations
        because the diff could not be read would be the original bug wearing a
        collector entry.
        """

        try:
            changed = diff.changed_lines(repo, context.base_commit, context.commit)
        except diff.DiffUnavailableError as err:
            evidence.runs.append(
                CollectorRun(
                    name="operations",
                    status="unavailable",
                    detail=f"could not read the diff: {err}",
                )
            )
            return

        found = migrations.inspect(repo, sorted(changed))
        evidence.operations = OperationsEvidence(
            migrations_detected=found.detected,
            migrations_reversible=found.reversible,
            rollback_available=found.rollback_available,
        )
        evidence.runs.append(
            CollectorRun(name="operations", status="ok", detail=found.detail)
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
