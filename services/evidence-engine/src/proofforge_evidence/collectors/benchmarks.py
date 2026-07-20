"""Reading benchmark results, and comparing a change against its base.

A regression is a comparison, and the manifest says so: every benchmark carries
a baseline and a candidate. So a single run measures nothing here — the change
has to be benchmarked against the commit it branched from, which means running
the suite twice, on two checkouts, in the sandbox.

Only pytest-benchmark is read. Its JSON is documented and stable, and a
benchmark tool whose output we guess at would produce percentages that look
measured. Everything else is reported as unsupported.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Benchmark:
    name: str
    baseline_ms: float
    candidate_ms: float
    regression_percentage: float


@dataclass
class BenchmarkEvidence:
    benchmarks: list[Benchmark] = field(default_factory=list)
    measured: bool = False
    detail: str = ""


class BenchmarkParseError(Exception):
    """Raised when a benchmark report cannot be read."""


@dataclass(frozen=True)
class Timing:
    """A benchmark's mean, and how much it varied while being measured."""

    mean_s: float
    #: Standard deviation across rounds. Zero when the report omits it, which
    #: makes the noise check fall back to reporting the difference as given.
    stddev_s: float = 0.0


def parse_pytest_benchmark(json_text: str) -> dict[str, Timing]:
    """Timings per benchmark, keyed by name, from pytest-benchmark JSON."""

    try:
        data = json.loads(json_text)
    except json.JSONDecodeError as err:
        raise BenchmarkParseError(f"invalid benchmark JSON: {err}") from err

    if not isinstance(data, dict):
        raise BenchmarkParseError("benchmark report should be a JSON object")

    entries = data.get("benchmarks")
    if not isinstance(entries, list):
        raise BenchmarkParseError("benchmark report has no benchmarks array")

    timings: dict[str, Timing] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("fullname") or entry.get("name")
        stats = entry.get("stats")
        if not isinstance(name, str) or not isinstance(stats, dict):
            continue
        mean = stats.get("mean")
        if not isinstance(mean, (int, float)):
            continue
        stddev = stats.get("stddev")
        timings[name] = Timing(
            mean_s=float(mean),
            stddev_s=float(stddev) if isinstance(stddev, (int, float)) else 0.0,
        )
    return timings


def compare(baseline: dict[str, Timing], candidate: dict[str, Timing]) -> BenchmarkEvidence:
    """Match benchmarks by name and report how each moved.

    A benchmark that exists on only one side is left out rather than compared
    against nothing: the manifest has no way to express "new, no baseline", and
    reporting 0% regression for it would claim a measurement never taken. The
    detail says how many were dropped and why.
    """

    shared = sorted(set(baseline) & set(candidate))
    if not shared:
        reason = (
            "no benchmarks ran"
            if not baseline and not candidate
            else "no benchmark ran on both the base and the change"
        )
        return BenchmarkEvidence(measured=False, detail=reason)

    results: list[Benchmark] = []
    zero_baseline = 0
    within_noise = 0

    for name in shared:
        before = baseline[name]
        after = candidate[name]
        # A baseline of zero cannot produce a percentage. Dividing by it would
        # be dividing by a number nobody measured properly.
        if before.mean_s <= 0:
            zero_baseline += 1
            continue

        difference = after.mean_s - before.mean_s
        if abs(difference) <= before.stddev_s + after.stddev_s:
            # The two runs happened in separate containers, so some of the gap
            # is the machine rather than the change. Counting it keeps the
            # detail honest about how many figures sit inside that variation.
            within_noise += 1

        results.append(
            Benchmark(
                name=name,
                baseline_ms=round(before.mean_s * 1000, 4),
                candidate_ms=round(after.mean_s * 1000, 4),
                regression_percentage=round(difference / before.mean_s * 100, 2),
            )
        )

    if not results:
        return BenchmarkEvidence(
            measured=False,
            detail=f"{zero_baseline} shared benchmark(s) reported a zero baseline",
        )

    only_new = len(set(candidate) - set(baseline))
    only_old = len(set(baseline) - set(candidate))

    detail = f"{len(results)} benchmark(s) compared"
    if within_noise:
        # Said plainly, because a percentage carries no indication of its own
        # footing and a reviewer would otherwise read 3% as a finding.
        detail += f"; {within_noise} within run-to-run variation"
    if zero_baseline:
        detail += f"; {zero_baseline} skipped for a zero baseline"
    if only_new:
        detail += f"; {only_new} new benchmark(s) had no baseline"
    if only_old:
        detail += f"; {only_old} benchmark(s) were removed"

    return BenchmarkEvidence(benchmarks=results, measured=True, detail=detail)


def read_report(path: Path) -> dict[str, Timing] | None:
    """Read a report the sandbox wrote, or None when the run produced none."""

    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    if not text.strip():
        return None
    try:
        return parse_pytest_benchmark(text)
    except BenchmarkParseError:
        return None
