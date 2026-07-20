"""Pure parsers for the machine-readable output of each analysis tool.

Keeping parsing separate from execution makes the trickiest logic fully
unit-testable against recorded tool output, with no tools or sandbox required.
"""

from __future__ import annotations

import json
from typing import Any
from xml.etree import ElementTree

from proofforge_evidence.models import SeverityCounts, TestEvidence


class ParseError(ValueError):
    """Raised when a tool's output cannot be understood."""


# ── tests: JUnit XML (pytest, vitest, jest, …) ──────────────────────────────


def parse_junit_xml(xml_text: str) -> TestEvidence:
    """Aggregate a JUnit report into pass/fail/skip counts and duration."""

    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as err:
        raise ParseError(f"invalid JUnit XML: {err}") from err

    suites = [root] if root.tag == "testsuite" else root.findall(".//testsuite")
    tests = failures = errors = skipped = 0
    duration = 0.0
    for suite in suites:
        tests += _int_attr(suite, "tests")
        failures += _int_attr(suite, "failures")
        errors += _int_attr(suite, "errors")
        skipped += _int_attr(suite, "skipped")
        duration += _float_attr(suite, "time")

    passed = max(tests - failures - errors - skipped, 0)
    return TestEvidence(
        passed=passed,
        failed=failures + errors,
        skipped=skipped,
        duration_ms=int(duration * 1000),
        collected=True,
    )


def _int_attr(element: ElementTree.Element, name: str) -> int:
    try:
        return int(element.get(name, "0") or "0")
    except ValueError:
        return 0


def _float_attr(element: ElementTree.Element, name: str) -> float:
    try:
        return float(element.get(name, "0") or "0")
    except ValueError:
        return 0.0


# ── coverage: Cobertura XML (coverage.py, nyc, vitest) ──────────────────────


def parse_cobertura_line_rate(xml_text: str) -> float:
    """Return total line coverage as a percentage (0–100) from a Cobertura report."""

    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as err:
        raise ParseError(f"invalid Cobertura XML: {err}") from err

    rate = root.get("line-rate")
    if rate is None:
        raise ParseError("Cobertura report has no line-rate attribute")
    try:
        return round(float(rate) * 100, 2)
    except ValueError as err:
        raise ParseError(f"invalid line-rate: {rate}") from err


def parse_cobertura_line_hits(xml_text: str) -> dict[str, dict[int, int]]:
    """Hit counts per line, keyed by the filename Cobertura reports.

    Needed for coverage of the changed lines specifically: the top-level
    line-rate covers the whole repository, which answers a different question
    and flatters a change that touched untested code inside a well-tested repo.
    """

    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as err:
        raise ParseError(f"invalid Cobertura XML: {err}") from err

    files: dict[str, dict[int, int]] = {}
    for class_element in root.iter("class"):
        filename = class_element.get("filename")
        if not filename:
            continue
        lines = files.setdefault(_normalise_path(filename), {})
        for line in class_element.iter("line"):
            number = line.get("number")
            if number is None:
                continue
            try:
                lines[int(number)] = int(line.get("hits", "0") or "0")
            except ValueError:
                # A malformed line entry is not worth failing the whole report
                # over; it just does not contribute a measurement.
                continue
    return files


def _normalise_path(path: str) -> str:
    """Compare paths the way both sides write them: forward slashes, no ./ prefix."""

    cleaned = path.replace("\\", "/").lstrip("./")
    return cleaned


# ── secrets: Gitleaks JSON ──────────────────────────────────────────────────


def parse_gitleaks(json_text: str) -> int:
    """Count secret findings in a Gitleaks JSON report (a top-level array)."""

    data = _load_json(json_text)
    if data is None:
        return 0
    if isinstance(data, list):
        return len(data)
    raise ParseError("Gitleaks report should be a JSON array")


# ── SAST: Semgrep JSON ──────────────────────────────────────────────────────

_SEMGREP_SEVERITY = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}


def parse_semgrep(json_text: str) -> SeverityCounts:
    """Bucket Semgrep results by severity."""

    data = _load_json(json_text)
    counts = SeverityCounts()
    if not isinstance(data, dict):
        return counts
    for result in data.get("results", []):
        if not isinstance(result, dict):
            continue
        severity = str(result.get("extra", {}).get("severity", "INFO")).upper()
        bucket = _SEMGREP_SEVERITY.get(severity, "low")
        _bump(counts, bucket)
    return counts


# ── vulnerabilities: Trivy JSON ─────────────────────────────────────────────


def parse_trivy(json_text: str) -> SeverityCounts:
    """Bucket Trivy vulnerabilities by severity across all results."""

    data = _load_json(json_text)
    counts = SeverityCounts()
    if not isinstance(data, dict):
        return counts
    for result in data.get("Results", []) or []:
        if not isinstance(result, dict):
            continue
        for vuln in result.get("Vulnerabilities", []) or []:
            if not isinstance(vuln, dict):
                continue
            severity = str(vuln.get("Severity", "")).lower()
            if severity in {"critical", "high", "medium", "low"}:
                _bump(counts, severity)
    return counts


# ── SBOM: Syft JSON ─────────────────────────────────────────────────────────


def parse_syft_component_count(json_text: str) -> int:
    """Count components (artifacts) in a Syft SBOM."""

    data = _load_json(json_text)
    if not isinstance(data, dict):
        raise ParseError("Syft SBOM should be a JSON object")
    artifacts = data.get("artifacts", [])
    return len(artifacts) if isinstance(artifacts, list) else 0


# ── helpers ─────────────────────────────────────────────────────────────────


def _load_json(text: str) -> Any:
    stripped = text.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as err:
        raise ParseError(f"invalid JSON: {err}") from err


def _bump(counts: SeverityCounts, bucket: str) -> None:
    setattr(counts, bucket, getattr(counts, bucket) + 1)
