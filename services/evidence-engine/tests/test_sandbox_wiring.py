"""The sandbox wiring, exercised without Docker by substituting the sandbox."""

import json
from pathlib import Path

from proofforge_evidence import runners
from proofforge_evidence.sandbox import SandboxResult, SandboxSpec, build_docker_command
from proofforge_evidence.toolchain import HostToolchain

JUNIT = '<testsuite tests="3" failures="0" errors="0" skipped="0" time="1"/>'
COBERTURA = '<coverage line-rate="0.91"></coverage>'


class RecordingSandbox:
    """Writes the reports a real runner would, and remembers the spec it got."""

    def __init__(self, *, junit: str | None = JUNIT, coverage: str | None = COBERTURA) -> None:
        self.spec: SandboxSpec | None = None
        self._junit = junit
        self._coverage = coverage

    def run(self, spec: SandboxSpec) -> SandboxResult:
        self.spec = spec
        out = next(m.host for m in spec.mounts if m.container == runners.OUTPUT_DIR)
        if self._junit is not None:
            (out / "junit.xml").write_text(self._junit, encoding="utf-8")
        if self._coverage is not None:
            (out / "coverage.xml").write_text(self._coverage, encoding="utf-8")
        return SandboxResult(exit_code=0, stdout="", stderr="", timed_out=False, duration_ms=120)


def node_repo(tmp_path: Path) -> Path:
    (tmp_path / "package.json").write_text(
        json.dumps({"devDependencies": {"vitest": "^2"}}), encoding="utf-8"
    )
    return tmp_path


def test_reports_are_collected_from_the_sandbox(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: True)
    sandbox = RecordingSandbox()

    junit, coverage = HostToolchain(sandbox=sandbox).run_tests(node_repo(tmp_path))

    assert junit.status == "ok"
    assert junit.text == JUNIT
    assert coverage.status == "ok"


def test_the_source_is_mounted_read_only_and_only_output_is_writable(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: True)
    sandbox = RecordingSandbox()

    HostToolchain(sandbox=sandbox).run_tests(node_repo(tmp_path))

    spec = sandbox.spec
    assert spec is not None
    source = next(m for m in spec.mounts if m.container == runners.SOURCE_MOUNT)
    output = next(m for m in spec.mounts if m.container == runners.OUTPUT_DIR)
    assert source.read_only is True
    assert output.read_only is False
    # The working copy is a throwaway volume, so a read-only root still holds.
    assert runners.WORK_DIR in spec.writable_volumes

    rendered = " ".join(build_docker_command(spec, container_name="c"))
    assert "--read-only" in rendered
    assert "--cap-drop ALL" in rendered
    assert "--security-opt no-new-privileges" in rendered
    assert "--user 10001:10001" in rendered


def test_network_is_on_only_because_installing_dependencies_needs_it(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: True)
    sandbox = RecordingSandbox()

    HostToolchain(sandbox=sandbox).run_tests(node_repo(tmp_path))

    assert sandbox.spec is not None
    assert sandbox.spec.network is True


def test_missing_junit_is_an_error_not_a_silent_pass(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: True)
    sandbox = RecordingSandbox(junit=None, coverage=None)

    junit, coverage = HostToolchain(sandbox=sandbox).run_tests(node_repo(tmp_path))

    assert junit.status == "error"
    assert "no JUnit report" in junit.detail
    assert coverage.status == "unavailable"


def test_coverage_alone_may_be_missing(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: True)
    sandbox = RecordingSandbox(coverage=None)

    junit, coverage = HostToolchain(sandbox=sandbox).run_tests(node_repo(tmp_path))

    assert junit.status == "ok"
    assert coverage.status == "unavailable"


def test_without_docker_nothing_runs_on_the_host(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: False)
    sandbox = RecordingSandbox()

    junit, _ = HostToolchain(sandbox=sandbox).run_tests(node_repo(tmp_path))

    assert junit.status == "unavailable"
    assert sandbox.spec is None  # never even attempted
