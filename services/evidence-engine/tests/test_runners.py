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
