"""The decisive conformance test: the Python hash of the canonical proof-manifest
must equal the hash the TypeScript evidence-spec stored in its own valid example.

If this passes, a manifest produced by the Python engine verifies under
`proofforge evidence verify` and any other conformant implementation.
"""

import json
from pathlib import Path

from proofforge_evidence.manifest_hash import canonicalize, compute_evidence_hash

# repo_root/services/evidence-engine/tests/this_file.py → repo root is 3 parents up
REPO_ROOT = Path(__file__).resolve().parents[3]
TS_EXAMPLE = REPO_ROOT / "packages" / "evidence-spec" / "examples" / "valid" / "github-oauth.json"


def test_python_hash_matches_typescript_example() -> None:
    manifest = json.loads(TS_EXAMPLE.read_text(encoding="utf-8"))
    stored = manifest["evidenceHash"]
    recomputed = compute_evidence_hash(manifest)
    assert recomputed == stored, (
        "Python canonical hash diverged from the TypeScript-produced hash.\n"
        f"  stored (TS):     {stored}\n"
        f"  recomputed (Py): {recomputed}"
    )


def test_hash_excludes_evidence_hash_and_signature_value() -> None:
    manifest = json.loads(TS_EXAMPLE.read_text(encoding="utf-8"))
    baseline = compute_evidence_hash(manifest)

    manifest["evidenceHash"] = "sha256:" + "f" * 64
    manifest["signature"]["value"] = "tampered-but-excluded"
    assert compute_evidence_hash(manifest) == baseline


def test_integer_valued_floats_match_javascript() -> None:
    # JavaScript has one number type: JSON.stringify(0.0) === "0", not "0.0".
    # Python must agree so a manifest with 0.0 coverage verifies cross-language.
    assert canonicalize(0.0) == "0"
    assert canonicalize(90.0) == "90"
    assert canonicalize(86.2) == "86.2"
    assert canonicalize({"a": 0.0, "b": 1}) == '{"a":0,"b":1}'
    assert canonicalize([1.0, 2.5, True, None]) == "[1,2.5,true,null]"
