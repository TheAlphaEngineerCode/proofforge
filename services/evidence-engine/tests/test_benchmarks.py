"""Comparing benchmarks across a change."""

import json

import pytest

from proofforge_evidence.collectors import benchmarks
from proofforge_evidence.collectors.benchmarks import Timing


def report(entries: dict[str, tuple[float, float]]) -> str:
    """A pytest-benchmark report: name -> (mean seconds, stddev seconds)."""
    return json.dumps(
        {
            "benchmarks": [
                {"fullname": name, "stats": {"mean": mean, "stddev": stddev}}
                for name, (mean, stddev) in entries.items()
            ]
        }
    )


class TestReadingAReport:
    def test_reads_the_mean_and_its_variation(self) -> None:
        parsed = benchmarks.parse_pytest_benchmark(report({"a": (0.5, 0.01)}))

        assert parsed["a"].mean_s == 0.5
        assert parsed["a"].stddev_s == 0.01

    def test_a_missing_stddev_is_zero_rather_than_a_failure(self) -> None:
        text = json.dumps({"benchmarks": [{"fullname": "a", "stats": {"mean": 0.2}}]})

        assert benchmarks.parse_pytest_benchmark(text)["a"].stddev_s == 0.0

    def test_rejects_something_that_is_not_a_report(self) -> None:
        with pytest.raises(benchmarks.BenchmarkParseError, match="no benchmarks array"):
            benchmarks.parse_pytest_benchmark('{"other": []}')

    def test_rejects_invalid_json(self) -> None:
        with pytest.raises(benchmarks.BenchmarkParseError, match="invalid"):
            benchmarks.parse_pytest_benchmark("{not json")

    def test_skips_an_entry_with_no_usable_mean(self) -> None:
        text = json.dumps(
            {
                "benchmarks": [
                    {"fullname": "a", "stats": {"mean": "fast"}},
                    {"fullname": "b", "stats": {"mean": 0.1}},
                ]
            }
        )

        assert set(benchmarks.parse_pytest_benchmark(text)) == {"b"}


class TestComparing:
    def test_reports_a_slowdown(self) -> None:
        found = benchmarks.compare({"a": Timing(0.10, 0.001)}, {"a": Timing(0.15, 0.001)})

        assert found.measured is True
        assert found.benchmarks[0].regression_percentage == pytest.approx(50.0)

    def test_reports_an_improvement_as_a_negative(self) -> None:
        found = benchmarks.compare({"a": Timing(0.20, 0.001)}, {"a": Timing(0.10, 0.001)})

        assert found.benchmarks[0].regression_percentage == pytest.approx(-50.0)

    def test_says_when_a_difference_sits_inside_run_to_run_variation(self) -> None:
        """The two runs happen in separate containers; some of the gap is the machine."""
        found = benchmarks.compare({"a": Timing(0.100, 0.010)}, {"a": Timing(0.103, 0.010)})

        # The figure is still reported — the schema requires one — but a reader
        # is told not to treat it as a finding.
        assert "within run-to-run variation" in found.detail

    def test_a_real_regression_is_not_called_noise(self) -> None:
        found = benchmarks.compare({"a": Timing(0.100, 0.001)}, {"a": Timing(0.300, 0.001)})

        assert "within run-to-run variation" not in found.detail

    def test_a_benchmark_with_no_baseline_is_left_out_and_counted(self) -> None:
        found = benchmarks.compare({"a": Timing(0.1)}, {"a": Timing(0.1), "b": Timing(0.2)})

        assert [item.name for item in found.benchmarks] == ["a"]
        # Reporting b at 0% would claim a comparison nobody made.
        assert "1 new benchmark(s) had no baseline" in found.detail

    def test_a_removed_benchmark_is_counted_too(self) -> None:
        found = benchmarks.compare({"a": Timing(0.1), "b": Timing(0.2)}, {"a": Timing(0.1)})

        assert "1 benchmark(s) were removed" in found.detail

    def test_a_zero_baseline_is_skipped_and_said_so(self) -> None:
        """Silently dropping it would lose a benchmark without any trace."""
        found = benchmarks.compare(
            {"a": Timing(0.0), "b": Timing(0.1)}, {"a": Timing(0.5), "b": Timing(0.1)}
        )

        assert [item.name for item in found.benchmarks] == ["b"]
        assert "1 skipped for a zero baseline" in found.detail

    def test_nothing_shared_is_not_a_measurement(self) -> None:
        found = benchmarks.compare({"a": Timing(0.1)}, {"b": Timing(0.1)})

        assert found.measured is False
        assert "on both" in found.detail

    def test_no_benchmarks_at_all(self) -> None:
        found = benchmarks.compare({}, {})

        assert found.measured is False
        assert found.detail == "no benchmarks ran"

    def test_every_baseline_zero_is_not_a_measurement(self) -> None:
        found = benchmarks.compare({"a": Timing(0.0)}, {"a": Timing(0.5)})

        assert found.measured is False
        assert "zero baseline" in found.detail
