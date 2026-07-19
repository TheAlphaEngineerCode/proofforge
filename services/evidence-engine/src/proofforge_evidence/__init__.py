"""ProofForge Evidence Engine.

Runs analysis tools (tests, coverage, secret/SAST/vulnerability scans, SBOM) —
untrusted code inside an isolated sandbox, static scanners on the host — and
consolidates the results into a verifiable ``proof-manifest.json`` whose hash and
signature are cross-compatible with ``packages/evidence-spec``.
"""

__all__ = ["__version__"]

from proofforge_evidence.version import __version__
