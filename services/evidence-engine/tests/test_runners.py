import json
from pathlib import Path

import pytest

from proofforge_evidence import runners


def write(repo: Path, name: str, content: str = "") -> None:
    (repo / name).write_text(content, encoding="utf-8")


class TestDetectStack:
    def test_python_project_with_pytest(self, tmp_path: Path) -> None:
        write(
            tmp_path,
            "pyproject.toml",
            '[project]\nname="x"\n[dependency-groups]\ndev=["pytest"]',
        )
        assert runners.detect_stack(tmp_path) == "pytest"

    def test_python_project_without_pytest_is_unsupported(self, tmp_path: Path) -> None:
        write(tmp_path, "requirements.txt", "requests==2.32.0\n")
        with pytest.raises(runners.UnsupportedStackError, match="without pytest"):
            runners.detect_stack(tmp_path)

    def test_node_project_with_vitest(self, tmp_path: Path) -> None:
        write(tmp_path, "package.json", json.dumps({"devDependencies": {"vitest": "^2"}}))
        assert runners.detect_stack(tmp_path) == "vitest"

    def test_node_project_with_jest_is_reported_not_guessed(self, tmp_path: Path) -> None:
        """Jest needs a separate reporter, so claiming support would be a lie."""
        write(tmp_path, "package.json", json.dumps({"devDependencies": {"jest": "^29"}}))
        with pytest.raises(runners.UnsupportedStackError, match="jest-junit"):
            runners.detect_stack(tmp_path)

    def test_empty_repository(self, tmp_path: Path) -> None:
        with pytest.raises(runners.UnsupportedStackError, match="no recognised"):
            runners.detect_stack(tmp_path)

    def test_malformed_package_json_does_not_crash(self, tmp_path: Path) -> None:
        write(tmp_path, "package.json", "{ not json")
        with pytest.raises(runners.UnsupportedStackError):
            runners.detect_stack(tmp_path)


class TestPlans:
    @pytest.mark.parametrize("stack", ["pytest", "vitest"])
    def test_plan_writes_reports_where_the_engine_reads_them(self, stack: str) -> None:
        plan = runners.plan_for(stack)

        assert runners.JUNIT_PATH in plan.script
        assert runners.COVERAGE_PATH in plan.script or runners.OUTPUT_DIR in plan.script
        # The read-only source is copied before anything writes to it.
        assert f"cp -a {runners.SOURCE_MOUNT}/." in plan.script
        assert plan.image

    @pytest.mark.parametrize("stack", ["pytest", "vitest"])
    def test_a_failing_suite_still_yields_reports(self, stack: str) -> None:
        """A failing suite is evidence, not a runner error — collect it either way."""
        assert runners.plan_for(stack).script.rstrip().endswith("|| true")

    @pytest.mark.parametrize("stack", ["pytest", "vitest"])
    def test_no_runner_writes_into_the_output_mount_point(self, stack: str) -> None:
        """A tool that clears its report directory must not be aimed at the mount.

        vitest's coverage provider removes the reports directory before writing;
        under a read-only root that is EROFS on a mount point, and it takes the
        whole run down rather than just coverage.
        """
        script = runners.plan_for(stack).script

        assert f"reportsDirectory={runners.OUTPUT_DIR}" not in script
        assert f"--cov-report=xml:{runners.OUTPUT_DIR} " not in script

    def test_unknown_stack(self) -> None:
        with pytest.raises(runners.UnsupportedStackError):
            runners.plan_for("maven")


class TestImages:
    """Which image the sandbox pulls, and who is allowed to publish it."""

    @pytest.mark.parametrize(
        ("stack", "expected"),
        [("pytest", runners.DEFAULT_PYTHON_IMAGE), ("vitest", runners.DEFAULT_NODE_IMAGE)],
    )
    def test_default_image_lives_where_we_can_publish_it(
        self, stack: str, expected: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An image in a namespace we do not own can never be pushed to.

        The first name here was `ghcr.io/proofforge/…`, which belongs to another
        account: every test run pulled an image that could not exist, and the
        collector reported a timeout that no amount of fixing here would clear.
        """
        monkeypatch.delenv(runners.PYTHON_IMAGE_ENV, raising=False)
        monkeypatch.delenv(runners.NODE_IMAGE_ENV, raising=False)

        assert runners.plan_for(stack).image == expected
        assert expected.startswith("ghcr.io/thealphaengineercode/")

    def test_images_can_be_pointed_elsewhere(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A fork, a mirror or an install with no route to ghcr needs its own."""
        monkeypatch.setenv(runners.PYTHON_IMAGE_ENV, "registry.internal/py:1")
        monkeypatch.setenv(runners.NODE_IMAGE_ENV, "registry.internal/node:1")

        assert runners.plan_for("pytest").image == "registry.internal/py:1"
        assert runners.plan_for("vitest").image == "registry.internal/node:1"

    def test_a_blank_override_is_not_an_image(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Deployments set variables to empty far more often than they unset them."""
        monkeypatch.setenv(runners.PYTHON_IMAGE_ENV, "   ")

        assert runners.plan_for("pytest").image == runners.DEFAULT_PYTHON_IMAGE

    def test_benchmarks_run_in_the_same_python_image(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(runners.PYTHON_IMAGE_ENV, "registry.internal/py:1")
        write(tmp_path, "pyproject.toml", '[project]\nname="x"\ndependencies=["pytest-benchmark"]')

        assert runners.benchmark_plan_for(tmp_path).image == "registry.internal/py:1"


def test_a_uv_workspace_installs_its_members_before_the_tests_run() -> None:
    # A bare `uv sync` on a workspace root installs the root project and none of
    # its members, so the tests cannot import what they test and pytest writes a
    # report full of collection errors. The parser would read that, correctly, as
    # a failing suite — a verdict about the change produced by a runner that
    # simply failed to install it.
    plan = runners.plan_for("pytest")

    assert "uv sync --frozen --all-packages" in plan.script


def test_the_uv_invocation_stays_within_the_pinned_uv_in_the_image() -> None:
    # `--active` was rejected by the uv the sandbox image pins, and under `set -e`
    # that killed the script before pytest ran — every uv project reported "no
    # JUnit report produced". Activating the venv first is what makes uv install
    # into the one we are about to run, so the flag buys nothing.
    plan = runners.plan_for("pytest")

    assert "--active" not in plan.script
    assert ". .venv/bin/activate" in plan.script
