"""Internal evidence models produced by collectors and consolidated by the engine.

These are the engine's working representation. The manifest builder maps them to
the wire format defined by ``packages/evidence-spec``.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SeverityCounts(BaseModel):
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0

    def total(self) -> int:
        return self.critical + self.high + self.medium + self.low


class TestEvidence(BaseModel):
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    duration_ms: int = 0
    coverage_total: float = 0.0
    # Coverage restricted to lines touched by the change. Until diff-aware
    # coverage lands this mirrors the total and is flagged as approximate.
    coverage_changed: float = 0.0
    coverage_is_approximate: bool = True
    #: Whether a coverage report was actually parsed. Without this, an absent
    #: report is indistinguishable from a genuine 0% and gets charged as one.
    coverage_collected: bool = False
    collected: bool = False


class SecurityEvidence(BaseModel):
    vulnerabilities: SeverityCounts = Field(default_factory=SeverityCounts)
    sast: SeverityCounts = Field(default_factory=SeverityCounts)
    secrets_detected: int = 0
    sbom_generated: bool = False
    sbom_components: int = 0


class CollectorRun(BaseModel):
    """Bookkeeping for a single collector: did it run, and what happened."""

    name: str
    status: str  # "ok" | "unavailable" | "error" | "timeout"
    detail: str = ""
    duration_ms: int = 0


class ConsolidatedEvidence(BaseModel):
    tests: TestEvidence = Field(default_factory=TestEvidence)
    security: SecurityEvidence = Field(default_factory=SecurityEvidence)
    runs: list[CollectorRun] = Field(default_factory=list)
