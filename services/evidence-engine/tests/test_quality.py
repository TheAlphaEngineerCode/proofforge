"""Complexity and duplication, and the languages neither claims to cover."""

from pathlib import Path

from proofforge_evidence.collectors import quality


def write(repo: Path, relative: str, text: str) -> None:
    path = repo / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class TestCyclomaticComplexity:
    def test_straight_line_code_has_one_path(self) -> None:
        assert quality.cyclomatic_complexity("x = 1\ny = x + 1\n") == 1

    def test_each_branch_adds_one(self) -> None:
        source = "def f(x):\n    if x:\n        return 1\n    return 0\n"

        assert quality.cyclomatic_complexity(source) == 2

    def test_a_chained_condition_counts_every_decision(self) -> None:
        """`a and b and c` is two decisions, not one."""
        single = quality.cyclomatic_complexity("def f(a, b):\n    return a and b\n")
        chained = quality.cyclomatic_complexity("def f(a, b, c):\n    return a and b and c\n")

        assert chained == single + 1

    def test_counts_loops_handlers_and_comprehension_guards(self) -> None:
        source = (
            "def f(items):\n"
            "    try:\n"
            "        for i in items:\n"
            "            pass\n"
            "    except ValueError:\n"
            "        pass\n"
            "    return [i for i in items if i]\n"
        )

        # base 1 + for + except + comprehension guard
        assert quality.cyclomatic_complexity(source) == 4

    def test_a_file_that_does_not_parse_returns_none(self) -> None:
        # None rather than 0: a file we could not read is not a simple file.
        assert quality.cyclomatic_complexity("def broken(:\n") is None


class TestMeasuringAChange:
    def test_reports_before_and_after_for_python(self, tmp_path: Path) -> None:
        write(tmp_path, "app.py", "def f(x):\n    if x:\n        return 1\n    return 0\n")

        found = quality.measure_complexity(tmp_path, ["app.py"], "abc1234")

        assert found.measured is True
        assert found.after == 2

    def test_says_so_rather_than_guessing_at_other_languages(self, tmp_path: Path) -> None:
        """Counting braces in TypeScript would look like a measurement."""
        write(tmp_path, "app.ts", "export function f(x: number) { return x > 0 ? 1 : 0; }\n")

        found = quality.measure_complexity(tmp_path, ["app.ts"], "abc1234")

        assert found.measured is False
        assert "app.ts" in found.unparsed
        assert "Python" in found.detail

    def test_names_the_unmeasured_languages_alongside_a_real_measurement(
        self, tmp_path: Path
    ) -> None:
        write(tmp_path, "app.py", "x = 1\n")
        write(tmp_path, "app.ts", "export const x = 1;\n")

        found = quality.measure_complexity(tmp_path, ["app.py", "app.ts"], "abc1234")

        # Measured, but the gap is visible rather than averaged away.
        assert found.measured is True
        assert "not measured" in found.detail

    def test_a_python_file_that_does_not_parse_is_not_counted_as_simple(
        self, tmp_path: Path
    ) -> None:
        write(tmp_path, "broken.py", "def f(:\n")

        found = quality.measure_complexity(tmp_path, ["broken.py"], "abc1234")

        assert found.measured is False
        assert "broken.py" in found.unparsed

    def test_a_commit_that_is_not_a_commit_id_yields_no_baseline(self, tmp_path: Path) -> None:
        """The argument is built as `commit:path`, so a leading dash is an option."""
        write(tmp_path, "app.py", "def f(x):\n    if x:\n        return 1\n    return 0\n")

        found = quality.measure_complexity(tmp_path, ["app.py"], "--output=/tmp/pwned")

        assert found.after == 2
        assert found.before == 0


class TestDuplication:
    def test_finds_a_repeated_block(self, tmp_path: Path) -> None:
        block = "".join(f"    step_{i}()\n" for i in range(8))
        write(tmp_path, "a.py", f"def one():\n{block}\ndef two():\n{block}")

        found = quality.measure_duplication(tmp_path, ["a.py"])

        assert found.measured is True
        assert found.percentage > 0

    def test_distinct_code_is_not_duplication(self, tmp_path: Path) -> None:
        write(tmp_path, "a.py", "".join(f"value_{i} = {i}\n" for i in range(40)))

        assert quality.measure_duplication(tmp_path, ["a.py"]).percentage == 0.0

    def test_ignores_boilerplate_that_repeats_everywhere(self, tmp_path: Path) -> None:
        """Closing braces and imports repeat in every file and mean nothing."""
        braces = "}\n" * 20
        write(tmp_path, "a.ts", f"const a = 1;\n{braces}")
        write(tmp_path, "b.ts", f"const b = 2;\n{braces}")

        assert quality.measure_duplication(tmp_path, ["a.ts", "b.ts"]).percentage == 0.0

    def test_says_so_when_there_is_nothing_to_measure(self, tmp_path: Path) -> None:
        found = quality.measure_duplication(tmp_path, ["README.md", "logo.png"])

        # Not 0% duplication — no source files were part of the change.
        assert found.measured is False
        assert "no source files" in found.detail

    def test_a_percentage_never_exceeds_a_hundred(self, tmp_path: Path) -> None:
        block = "".join(f"    call_{i}()\n" for i in range(7))
        write(tmp_path, "a.py", f"def f():\n{block}" * 30)

        assert quality.measure_duplication(tmp_path, ["a.py"]).percentage <= 100.0


class TestInsideTheEngine:
    def test_an_unreadable_diff_leaves_both_unavailable(self, tmp_path: Path) -> None:
        from proofforge_evidence.context import ChangeContext, RepositoryRef
        from proofforge_evidence.engine import EvidenceEngine
        from proofforge_evidence.models import ConsolidatedEvidence

        repo = tmp_path / "repo"
        repo.mkdir()
        evidence = ConsolidatedEvidence()
        context = ChangeContext(
            repository=RepositoryRef(owner="a", name="b", url="https://example/a/b"),
            commit="9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
            base_commit="1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
            branch="main",
            title="t",
        )

        EvidenceEngine(_NullToolchain())._collect_quality(repo, context, evidence)

        statuses = {run.name: run.status for run in evidence.runs}
        assert statuses["complexity"] == "unavailable"
        assert statuses["duplication"] == "unavailable"

    def test_complexity_can_be_unavailable_while_duplication_succeeds(
        self, tmp_path: Path
    ) -> None:
        """A single `quality: ok` would hide which of the two actually ran."""
        from proofforge_evidence.context import ChangeContext, RepositoryRef
        from proofforge_evidence.engine import EvidenceEngine
        from proofforge_evidence.models import ConsolidatedEvidence

        repo = tmp_path / "repo"
        repo.mkdir()
        # A TypeScript-only change: nothing here can measure its complexity.
        write(repo, "app.ts", "".join(f"const value{i} = {i};\n" for i in range(30)))
        evidence = ConsolidatedEvidence()
        context = ChangeContext(
            repository=RepositoryRef(owner="a", name="b", url="https://example/a/b"),
            commit="9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
            base_commit="1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
            branch="main",
            title="t",
        )
        engine = EvidenceEngine(_NullToolchain())

        import proofforge_evidence.engine as engine_module

        original = engine_module.diff.changed_lines
        engine_module.diff.changed_lines = lambda *_: {"app.ts": {1}}
        try:
            engine._collect_quality(repo, context, evidence)
        finally:
            engine_module.diff.changed_lines = original

        statuses = {run.name: run.status for run in evidence.runs}
        assert statuses["complexity"] == "unavailable"
        assert statuses["duplication"] == "ok"


class _NullToolchain:
    def run_tests(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def scan_secrets(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def scan_sast(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def scan_vulnerabilities(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def generate_sbom(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")
