"""The sandbox wiring, exercised without Docker by substituting the sandbox."""

import json
from pathlib import Path

from proofforge_evidence import runners
from proofforge_evidence.sandbox import SandboxResult, SandboxSpec, build_docker_command
from proofforge_evidence.toolchain import TIMEOUT_ENV, HostToolchain, default_timeout_s

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


DIGEST = "ghcr.io/thealphaengineercode/proofforge-sandbox-node@sha256:" + "a" * 64


class DigestReportingSandbox(RecordingSandbox):
    """A sandbox that names what it ran, the way the Docker one does."""

    def run(self, spec: SandboxSpec) -> SandboxResult:
        result = super().run(spec)
        return SandboxResult(
            exit_code=result.exit_code,
            stdout=result.stdout,
            stderr=result.stderr,
            timed_out=result.timed_out,
            duration_ms=result.duration_ms,
            image=DIGEST,
        )


def test_the_image_reported_is_the_one_that_ran(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: True)
    toolchain = HostToolchain(sandbox=DigestReportingSandbox())

    toolchain.run_tests(node_repo(tmp_path))

    assert toolchain.observed_image() == DIGEST


def test_no_image_is_claimed_when_nothing_ran(tmp_path: Path, monkeypatch) -> None:
    # No Docker means repository code never executed. An empty answer is the
    # point: the manifest would otherwise name an image that ran nothing.
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: False)
    toolchain = HostToolchain(sandbox=RecordingSandbox())

    junit, _ = toolchain.run_tests(node_repo(tmp_path))

    assert junit.status == "unavailable"
    assert toolchain.observed_image() == ""


def test_the_tool_timeout_can_be_raised_for_slow_repositories(tmp_path: Path, monkeypatch) -> None:
    # Five minutes has to cover installing dependencies before a test runs, and a
    # monorepo can spend all of it on the install alone. Without this knob such a
    # repository is permanently reported as `timeout`.
    monkeypatch.setenv(TIMEOUT_ENV, "1800")
    monkeypatch.setattr("proofforge_evidence.toolchain.docker_available", lambda: True)
    sandbox = RecordingSandbox()

    HostToolchain(sandbox=sandbox).run_tests(node_repo(tmp_path))

    assert sandbox.spec is not None
    assert sandbox.spec.timeout_s == 1800


def test_an_unusable_timeout_is_ignored_rather_than_obeyed(monkeypatch) -> None:
    # A zero or negative timeout would fail every collector instantly, and a
    # manifest full of timeouts reads like a repository with nothing to measure.
    # Falling back is the only reading that cannot mislead.
    for value in ("0", "-30", "soon", ""):
        monkeypatch.setenv(TIMEOUT_ENV, value)
        assert default_timeout_s() == 300


def test_the_default_timeout_stands_when_nothing_is_set(monkeypatch) -> None:
    monkeypatch.delenv(TIMEOUT_ENV, raising=False)

    assert default_timeout_s() == 300
