"""Interim, transparent risk scoring.

This is a deterministic placeholder so manifests carry a meaningful, explainable
risk value now. The full Risk Engine (Phase 6) will supersede it with documented,
configurable weights. Every number here is justifiable from the evidence, and the
reasons list always states that the score is interim.
"""

from __future__ import annotations

from proofforge_evidence.models import ConsolidatedEvidence

RiskLevel = str  # "low" | "moderate" | "elevated" | "high" | "critical"


def _level(score: int) -> RiskLevel:
    if score <= 20:
        return "low"
    if score <= 40:
        return "moderate"
    if score <= 60:
        return "elevated"
    if score <= 80:
        return "high"
    return "critical"


def _clamp(value: int) -> int:
    return max(0, min(100, value))


#: Collectors whose absence leaves a security question unanswered.
#:
#: SBOM is deliberately absent: it is an inventory artifact, not a detector. Not
#: having one limits what you can audit later, but it does not leave "is this
#: change vulnerable?" unanswered the way a missing scanner does.
SECURITY_COLLECTORS = frozenset({"secrets", "sast", "vulnerabilities"})

#: Charged once per security signal the run could not measure. Deliberately
#: moderate: unmeasured is a real gap, but it is weaker evidence of danger than
#: an actual finding, and it should not by itself dominate the score.
UNMEASURED_PENALTY = 8

# Every weight lives here so the score can be calibrated in one place, and every
# reason string derives from these values — a message must never quote a number
# the formula no longer uses. Keep docs/risk-score.md in step.
CRITICAL_VULN_PENALTY = 40
HIGH_VULN_PENALTY = 15
HIGH_SAST_PENALTY = 10
SECRET_PENALTY = 30
FAILED_TEST_PENALTY = 25
COVERAGE_TARGET = 90.0

#: Charged when the runner worked and the repository has no tests. The heaviest
#: single term in the model: tests are the primary evidence that a change does
#: what it claims, so their absence dominates the score by design.
NO_TESTS_PENALTY = 50

#: Charged when the tests ran but produced no coverage report. Same reasoning as
#: the other unmeasured penalties: silence costs something, but far less than a
#: measured shortfall would.
UNMEASURED_COVERAGE_PENALTY = 15

#: Charged when we could not execute the tests at all — no sandbox image, a
#: crashed runner, a timeout. Deliberately lighter than NO_TESTS_PENALTY: this is
#: our inability to measure, not a finding about the repository. It still costs
#: something, because unmeasured is not the same as clean.
UNMEASURED_TESTS_PENALTY = 20


def compute_interim_risk(evidence: ConsolidatedEvidence) -> dict[str, object]:
    """Return a manifest ``risk`` object derived from the evidence."""

    reasons: list[str] = []
    sec = evidence.security
    tests = evidence.tests

    findings_score = (
        sec.vulnerabilities.critical * CRITICAL_VULN_PENALTY
        + sec.vulnerabilities.high * HIGH_VULN_PENALTY
        + sec.sast.high * HIGH_SAST_PENALTY
        + sec.secrets_detected * SECRET_PENALTY
    )

    # A scanner that never ran produces the same zero as a clean scan. Charging
    # for the difference is the whole point: silence is not evidence of safety.
    # A set, so a collector reported twice is still charged once.
    unmeasured = sorted(
        {
            run.name
            for run in evidence.runs
            if run.name in SECURITY_COLLECTORS and run.status != "ok"
        }
    )
    security_score = _clamp(findings_score + len(unmeasured) * UNMEASURED_PENALTY)

    if sec.vulnerabilities.critical:
        reasons.append(
            f"{sec.vulnerabilities.critical} critical vulnerabilities "
            f"(+{CRITICAL_VULN_PENALTY} each)."
        )
    if sec.secrets_detected:
        reasons.append(f"{sec.secrets_detected} secrets detected (+{SECRET_PENALTY} each).")
    if unmeasured:
        reasons.append(
            f"{len(unmeasured)} security signals were not measured "
            f"({', '.join(unmeasured)}) (+{UNMEASURED_PENALTY} each): unverified, not clean."
        )

    # Three different situations that all used to look like "no tests":
    # we could not run them, we ran them and there were none, or we have results.
    # Only the middle one is a statement about the repository.
    tests_ran = any(run.name == "tests" and run.status == "ok" for run in evidence.runs)
    total_tests = tests.passed + tests.failed + tests.skipped

    if not tests_ran:
        tests_score = UNMEASURED_TESTS_PENALTY
        reasons.append(
            f"Tests could not be executed (+{UNMEASURED_TESTS_PENALTY}): behaviour is "
            "unverified, but this reflects the runner, not the repository."
        )
    elif total_tests == 0:
        tests_score = NO_TESTS_PENALTY
        reasons.append(
            f"The test run completed and found no tests (+{NO_TESTS_PENALTY}): "
            "nothing asserts that this change behaves as intended."
        )
    else:
        tests_score = tests.failed * FAILED_TEST_PENALTY
        if tests.failed:
            reasons.append(f"{tests.failed} failing tests (+{FAILED_TEST_PENALTY} each).")

        # Only charge the coverage gap when coverage was actually reported. An
        # absent report reads as 0%, and billing that as a 90-point shortfall
        # would punish a repository for a collector that never produced output.
        if not tests.coverage_collected:
            tests_score += UNMEASURED_COVERAGE_PENALTY
            reasons.append(
                f"No coverage report (+{UNMEASURED_COVERAGE_PENALTY}): the tests ran, "
                "but how much of the change they exercise is unknown."
            )
        elif tests.coverage_total < COVERAGE_TARGET:
            gap = int(COVERAGE_TARGET - tests.coverage_total)
            tests_score += gap
            reasons.append(
                f"Coverage {tests.coverage_total:.1f}% below the "
                f"{COVERAGE_TARGET:.0f}% guideline (+{gap})."
            )

        tests_score = _clamp(tests_score)

    categories = {
        "security": security_score,
        "tests": tests_score,
    }
    # Overall favors the worst signal, softened by the average, so a single
    # critical finding dominates without being the only input.
    worst = max(categories.values())
    average = sum(categories.values()) // len(categories)
    score = _clamp(round(0.6 * worst + 0.4 * average))

    reasons.append(
        "Scored from collected evidence and from what could not be collected; "
        "see docs/risk-score.md for the weights."
    )

    return {
        "score": score,
        "level": _level(score),
        "categories": categories,
        "reasons": reasons,
    }
