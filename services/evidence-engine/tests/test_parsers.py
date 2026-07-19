from collections.abc import Callable

import pytest

from proofforge_evidence.collectors import parsers

Reader = Callable[[str], str]


def test_parse_junit_aggregates_suites(read_fixture: Reader) -> None:
    ev = parsers.parse_junit_xml(read_fixture("junit.xml"))
    # 10 + 2 tests, 1 failure, 2 skipped -> 9 passed
    assert ev.passed == 9
    assert ev.failed == 1
    assert ev.skipped == 2
    assert ev.duration_ms == 1500
    assert ev.collected is True


def test_parse_junit_single_suite_root() -> None:
    xml = '<testsuite tests="3" failures="1" errors="1" skipped="0" time="0.1"/>'
    ev = parsers.parse_junit_xml(xml)
    assert ev.passed == 1
    assert ev.failed == 2  # failures + errors


def test_parse_cobertura_line_rate(read_fixture: Reader) -> None:
    assert parsers.parse_cobertura_line_rate(read_fixture("cobertura.xml")) == 86.2


def test_parse_gitleaks_counts_findings(read_fixture: Reader) -> None:
    assert parsers.parse_gitleaks(read_fixture("gitleaks.json")) == 1
    assert parsers.parse_gitleaks("[]") == 0
    assert parsers.parse_gitleaks("") == 0


def test_parse_semgrep_buckets_severity(read_fixture: Reader) -> None:
    counts = parsers.parse_semgrep(read_fixture("semgrep.json"))
    assert (counts.high, counts.medium, counts.low) == (1, 1, 1)


def test_parse_trivy_buckets_severity(read_fixture: Reader) -> None:
    counts = parsers.parse_trivy(read_fixture("trivy.json"))
    assert (counts.critical, counts.high, counts.medium, counts.low) == (1, 1, 2, 1)


def test_parse_syft_component_count(read_fixture: Reader) -> None:
    assert parsers.parse_syft_component_count(read_fixture("syft.json")) == 2


def test_invalid_json_raises_parse_error() -> None:
    with pytest.raises(parsers.ParseError):
        parsers.parse_trivy("{ not json")


def test_invalid_xml_raises_parse_error() -> None:
    with pytest.raises(parsers.ParseError):
        parsers.parse_junit_xml("<not-closed")
