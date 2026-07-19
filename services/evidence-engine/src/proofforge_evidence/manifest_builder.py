"""Build a schema-valid proof-manifest from consolidated evidence.

The output conforms to ``packages/evidence-spec`` (the Zod schema is strict, so
field names and shapes must match exactly) and carries a cross-language
``evidenceHash``. Quality, performance and operations fields are emitted with
honest "not yet measured" defaults — they are enriched in later phases.
"""

from __future__ import annotations

import platform
import uuid
from datetime import UTC, datetime
from typing import Any

from proofforge_evidence.context import Artifact, ChangeContext
from proofforge_evidence.manifest_hash import compute_evidence_hash
from proofforge_evidence.models import ConsolidatedEvidence
from proofforge_evidence.risk import compute_interim_risk
from proofforge_evidence.version import SPEC_VERSION, __version__


def build_manifest(
    context: ChangeContext,
    evidence: ConsolidatedEvidence,
    artifacts: list[Artifact],
    *,
    container_image: str = "",
) -> dict[str, Any]:
    """Assemble the manifest dict and stamp its evidence hash."""

    tests = evidence.tests
    sec = evidence.security
    refs = [a.to_ref() for a in artifacts]

    manifest: dict[str, Any] = {
        "specVersion": SPEC_VERSION,
        "id": str(uuid.uuid4()),
        "repository": {
            "provider": context.repository.provider,
            "owner": context.repository.owner,
            "name": context.repository.name,
            "url": context.repository.url,
        },
        "change": {
            "commit": context.commit,
            "baseCommit": context.base_commit,
            "branch": context.branch,
            "pullRequest": context.pull_request,
            "title": context.title,
            "request": context.request,
            "type": context.mode,
        },
        "environment": {
            "runnerVersion": __version__,
            "operatingSystem": platform.system().lower() or "unknown",
            "containerImage": container_image,
            "runtimeVersions": {"python": platform.python_version()},
            "dependencyLockHashes": {},
        },
        "tests": {
            "passed": tests.passed,
            "failed": tests.failed,
            "skipped": tests.skipped,
            "durationMs": tests.duration_ms,
            "coverage": {
                "total": tests.coverage_total,
                "changedLines": tests.coverage_changed,
            },
            "reports": [a.to_ref() for a in artifacts if a.type in {"junit", "coverage"}],
        },
        "security": {
            "criticalVulnerabilities": sec.vulnerabilities.critical,
            "highVulnerabilities": sec.vulnerabilities.high,
            "mediumVulnerabilities": sec.vulnerabilities.medium,
            "lowVulnerabilities": sec.vulnerabilities.low,
            "secretsDetected": sec.secrets_detected,
            "sbomGenerated": sec.sbom_generated,
            "sbomUrl": next((a.path for a in artifacts if a.type == "sbom"), ""),
            "reports": [
                a.to_ref()
                for a in artifacts
                if a.type in {"sast", "vulnerabilities", "secrets", "sbom"}
            ],
        },
        "quality": {
            "complexityBefore": 0,
            "complexityAfter": 0,
            "duplicatedLinesPercentage": 0,
            "newDependencies": [],
            "removedDependencies": [],
            "architectureViolations": [],
        },
        "performance": {"benchmarks": []},
        "operations": {
            "migrationsDetected": False,
            "migrationsReversible": True,
            "rollbackAvailable": True,
            "downtimeRequired": False,
        },
        "risk": compute_interim_risk(evidence),
        "policies": {"passed": [], "failed": [], "warnings": []},
        "agents": [],
        "artifacts": refs,
        "evidenceHash": "",
        "signature": {"algorithm": "ed25519", "publicKeyId": "", "value": ""},
        "createdAt": datetime.now(UTC).isoformat(),
    }

    # Drop the optional pullRequest key entirely when absent, matching the
    # TypeScript producer (undefined, not null) so the hash lines up.
    if manifest["change"]["pullRequest"] is None:
        del manifest["change"]["pullRequest"]

    manifest["evidenceHash"] = compute_evidence_hash(manifest)
    return manifest
