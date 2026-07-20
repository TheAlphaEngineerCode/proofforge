"""Coverage over the lines a change added."""

from pathlib import Path

import pytest

from proofforge_evidence import changed_coverage, diff

DIFF = """\
diff --git a/src/cart.py b/src/cart.py
index 111..222 100644
--- a/src/cart.py
+++ b/src/cart.py
@@ -10,0 +11,3 @@ def total(items):
+    if not items:
+        return 0
+    # a comment
@@ -30,0 +34,1 @@ def discount(amount):
+    return amount
"""


def cobertura(lines: dict[int, int], filename: str = "src/cart.py") -> str:
    entries = "".join(f'<line number="{n}" hits="{h}"/>' for n, h in lines.items())
    return (
        '<?xml version="1.0"?><coverage line-rate="0.9"><packages><package><classes>'
        f'<class filename="{filename}"><lines>{entries}</lines></class>'
        "</classes></package></packages></coverage>"
    )


class TestParsingTheDiff:
    def test_collects_added_lines_per_file(self) -> None:
        assert diff.parse_unified_diff(DIFF) == {"src/cart.py": {11, 12, 13, 34}}

    def test_ignores_deletions(self) -> None:
        deletion = (
            "diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -5,2 +4,0 @@\n-gone\n-also gone\n"
        )
        assert diff.parse_unified_diff(deletion) == {"x.py": set()}

    def test_ignores_a_deleted_file_entirely(self) -> None:
        removed = "diff --git a/x.py b/x.py\n--- a/x.py\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n"
        assert removed and diff.parse_unified_diff(removed) == {}


class TestMeasuring:
    def test_counts_only_the_added_lines(self, tmp_path: Path) -> None:
        # Line 99 is covered but was not part of the change; it must not count.
        coverage = cobertura({11: 1, 12: 0, 34: 1, 99: 1})

        result = _measure(tmp_path, coverage)

        assert result.measured_lines == 3
        assert result.covered_lines == 2
        assert result.percentage == pytest.approx(66.67)

    def test_skips_lines_the_tool_considers_non_executable(self, tmp_path: Path) -> None:
        """A comment has no coverage to report, and is not an uncovered line."""
        # Line 13 is the comment: absent from the report entirely.
        result = _measure(tmp_path, cobertura({11: 1, 12: 1, 34: 1}))

        assert result.measured_lines == 3
        assert result.percentage == 100.0

    def test_matches_a_coverage_path_reported_from_a_source_root(self, tmp_path: Path) -> None:
        # Coverage tools often drop the leading directory the diff includes.
        result = _measure(tmp_path, cobertura({11: 1, 12: 1, 34: 1}, filename="cart.py"))

        assert result.measured


class TestSayingSoWhenItCannotBeMeasured:
    def test_an_unreadable_diff_is_not_zero_percent(self, tmp_path: Path) -> None:
        result = changed_coverage.compute(tmp_path, "base", "head", cobertura({1: 1}))

        # tmp_path is not a git repository, so the diff cannot be read.
        assert result.percentage is None
        assert "diff" in result.detail

    def test_a_broken_report_is_not_zero_percent(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.setattr(diff, "changed_lines", lambda *_: {"src/cart.py": {11}})

        result = changed_coverage.compute(tmp_path, "base", "head", "<not xml")

        assert result.percentage is None
        assert "coverage report" in result.detail

    def test_a_pure_deletion_is_not_zero_percent(self, tmp_path: Path, monkeypatch) -> None:
        """Nothing was added, so nothing went untested."""
        monkeypatch.setattr(diff, "changed_lines", lambda *_: {})

        result = changed_coverage.compute(tmp_path, "base", "head", cobertura({1: 1}))

        assert result.percentage is None
        assert "added no lines" in result.detail

    def test_added_lines_absent_from_the_report_are_not_zero_percent(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        """A change touching only files the coverage run never saw."""
        monkeypatch.setattr(diff, "changed_lines", lambda *_: {"docs/readme.md": {1, 2}})

        result = changed_coverage.compute(tmp_path, "base", "head", cobertura({11: 1}))

        assert result.percentage is None
        assert "no added line" in result.detail

    def test_an_ambiguous_path_match_is_refused(self, tmp_path: Path, monkeypatch) -> None:
        """Two files ending the same way: attributing coverage would be a guess."""
        monkeypatch.setattr(diff, "changed_lines", lambda *_: {"a/util.py": {5}})
        report = (
            '<?xml version="1.0"?><coverage line-rate="1"><packages><package><classes>'
            '<class filename="x/util.py"><lines><line number="5" hits="1"/></lines></class>'
            '<class filename="y/util.py"><lines><line number="5" hits="1"/></lines></class>'
            "</classes></package></packages></coverage>"
        )

        assert changed_coverage.compute(tmp_path, "b", "h", report).percentage is None


def _measure(tmp_path: Path, coverage_xml: str) -> changed_coverage.ChangedCoverage:
    import proofforge_evidence.changed_coverage as module

    original = module.diff.changed_lines
    module.diff.changed_lines = lambda *_: diff.parse_unified_diff(DIFF)  # type: ignore[assignment]
    try:
        return changed_coverage.compute(tmp_path, "base", "head", coverage_xml)
    finally:
        module.diff.changed_lines = original  # type: ignore[assignment]
