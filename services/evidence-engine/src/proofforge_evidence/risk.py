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
SECURITY_COLLECTORS = frozenset({"secrets", "sast", "vulnerabilities", "sbom"})

#: Charged once per security signal the run could not measure.
UNMEASURED_PENALTY = 12


def compute_interim_risk(evidence: ConsolidatedEvidence) -> dict[str, object]:
    """Return a manifest ``risk`` object derived from the evidence."""

    reasons: list[str] = []
    sec = evidence.security
    tests = evidence.tests

    findings_score = (
        sec.vulnerabilities.critical * 40
        + sec.vulnerabilities.high * 15
        + sec.sast.high * 10
        + sec.secrets_detected * 30
    )

    # A scanner that never ran produces the same zero as a clean scan. Charging
    # for the difference is the whole point: silence is not evidence of safety.
    unmeasured = sorted(
        run.name for run in evidence.runs if run.name in SECURITY_COLLECTORS and run.status != "ok"
    )
    security_score = _clamp(findings_score + len(unmeasured) * UNMEASURED_PENALTY)

    if sec.vulnerabilities.critical:
        reasons.append(f"{sec.vulnerabilities.critical} critical vulnerabilities (+40 each).")
    if sec.secrets_detected:
        reasons.append(f"{sec.secrets_detected} secrets detected (+30 each).")
    if unmeasured:
        reasons.append(
            f"{len(unmeasured)} security signals were not measured "
            f"({', '.join(unmeasured)}) (+{UNMEASURED_PENALTY} each): unverified, not clean."
        )

    if tests.collected:
        coverage_gap = max(0.0, 90.0 - tests.coverage_total)
        tests_score = _clamp(tests.failed * 25 + int(coverage_gap))
        if tests.failed:
            reasons.append(f"{tests.failed} failing tests (+25 each).")
        if tests.coverage_total < 90:
            reasons.append(f"Coverage {tests.coverage_total:.1f}% below the 90% guideline.")
    else:
        tests_score = 50
        reasons.append("No test evidence collected (+50): unable to confirm behavior.")

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
