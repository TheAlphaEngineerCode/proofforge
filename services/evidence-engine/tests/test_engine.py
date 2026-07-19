from collections.abc import Callable
from pathlib import Path

from proofforge_evidence.context import ChangeContext, RepositoryRef
from proofforge_evidence.engine import EvidenceEngine, RawOutput
from proofforge_evidence.manifest_hash import compute_evidence_hash

Reader = Callable[[str], str]

REQUIRED_KEYS = {
    "specVersion", "id", "repository", "change", "environment", "tests", "security",
    "quality", "performance", "operations", "risk", "policies", "agents", "artifacts",
    "evidenceHash", "signature", "createdAt",
}


class FakeToolchain:
    """Feeds recorded fixture output, exercising the full parse/consolidate path."""

    def __init__(self, read: Reader) -> None:
        self._read = read

    def run_tests(self, repo: Path) -> tuple[RawOutput, RawOutput]:
        return (
            RawOutput(status="ok", text=self._read("junit.xml")),
            RawOutput(status="ok", text=self._read("cobertura.xml")),
        )

    def scan_secrets(self, repo: Path) -> RawOutput:
        return RawOutput(status="ok", text=self._read("gitleaks.json"))

    def scan_sast(self, repo: Path) -> RawOutput:
        return RawOutput(status="ok", text=self._read("semgrep.json"))

    def scan_vulnerabilities(self, repo: Path) -> RawOutput:
        return RawOutput(status="ok", text=self._read("trivy.json"))

    def generate_sbom(self, repo: Path) -> RawOutput:
        return RawOutput(status="ok", text=self._read("syft.json"))


class EmptyToolchain:
    def run_tests(self, repo: Path) -> tuple[RawOutput, RawOutput]:
        return RawOutput(status="unavailable"), RawOutput(status="unavailable")

    def scan_secrets(self, repo: Path) -> RawOutput:
        return RawOutput(status="unavailable")

    def scan_sast(self, repo: Path) -> RawOutput:
        return RawOutput(status="unavailable")

    def scan_vulnerabilities(self, repo: Path) -> RawOutput:
        return RawOutput(status="unavailable")

    def generate_sbom(self, repo: Path) -> RawOutput:
        return RawOutput(status="unavailable")


def _context() -> ChangeContext:
    return ChangeContext(
        repository=RepositoryRef(owner="pf", name="ex", url="https://github.com/pf/ex"),
        commit="9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
        base_commit="1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        branch="feature/x",
        title="Example change",
        pull_request=42,
    )


def test_engine_builds_bundle_and_consolidates_evidence(
    tmp_path: Path, read_fixture: Reader
) -> None:
    engine = EvidenceEngine(FakeToolchain(read_fixture), container_image="img@sha256:abc")
    result = engine.run(tmp_path / "repo", _context(), tmp_path / "bundle")

    ev = result.evidence
    assert (ev.tests.passed, ev.tests.failed, ev.tests.skipped) == (9, 1, 2)
    assert ev.tests.coverage_total == 86.2
    assert ev.security.secrets_detected == 1
    assert (ev.security.vulnerabilities.critical, ev.security.vulnerabilities.high) == (1, 1)
    assert ev.security.sast.high == 1
    assert ev.security.sbom_generated is True
    assert ev.security.sbom_components == 2
    assert {r.name for r in ev.runs} == {"tests", "secrets", "sast", "vulnerabilities", "sbom"}
    assert all(r.status == "ok" for r in ev.runs)


def test_manifest_is_schema_shaped_and_self_consistent(
    tmp_path: Path, read_fixture: Reader
) -> None:
    engine = EvidenceEngine(FakeToolchain(read_fixture))
    result = engine.run(tmp_path / "repo", _context(), tmp_path / "bundle")
    manifest = result.manifest

    assert set(manifest.keys()) == REQUIRED_KEYS
    # the stored hash matches a recomputation → verifiable by any implementation
    assert compute_evidence_hash(manifest) == manifest["evidenceHash"]
    assert manifest["security"]["criticalVulnerabilities"] == 1
    assert manifest["risk"]["score"] > 0


def test_bundle_files_and_artifacts_written(tmp_path: Path, read_fixture: Reader) -> None:
    engine = EvidenceEngine(FakeToolchain(read_fixture))
    bundle = tmp_path / "bundle"
    engine.run(tmp_path / "repo", _context(), bundle)

    assert (bundle / "proof-manifest.json").exists()
    assert (bundle / "evidence.json").exists()
    assert (bundle / "artifacts" / "gitleaks.json").exists()
    assert (bundle / "artifacts" / "trivy.json").exists()
    # secret-bearing raw reports must never be committed by accident
    assert (bundle / ".gitignore").read_text(encoding="utf-8").strip() == "*"


def test_pull_request_omitted_when_absent(tmp_path: Path, read_fixture: Reader) -> None:
    ctx = _context()
    ctx.pull_request = None
    engine = EvidenceEngine(FakeToolchain(read_fixture))
    result = engine.run(tmp_path / "repo", ctx, tmp_path / "bundle")
    assert "pullRequest" not in result.manifest["change"]


def test_all_unavailable_still_produces_valid_manifest(tmp_path: Path) -> None:
    engine = EvidenceEngine(EmptyToolchain())
    result = engine.run(tmp_path / "repo", _context(), tmp_path / "bundle")
    manifest = result.manifest
    assert compute_evidence_hash(manifest) == manifest["evidenceHash"]
    assert manifest["tests"]["passed"] == 0
    # no test evidence → interim risk flags it
    assert manifest["risk"]["score"] >= 30
