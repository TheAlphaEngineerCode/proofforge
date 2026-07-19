"""Deterministic canonicalization and evidence hashing — the Python counterpart
of ``packages/evidence-spec`` (canonicalize.ts / hash.ts).

Both implementations MUST agree byte-for-byte so a manifest produced by this
engine verifies under the TypeScript CLI and vice versa. The canonical form is:

  - object keys sorted lexicographically (ASCII keys → identical to JS ``.sort()``);
  - no insignificant whitespace;
  - non-ASCII kept raw (UTF-8), matching ``JSON.stringify`` with default options;
  - numbers via Python's shortest round-trippable ``repr`` (equal to JS for the
    normal-range values manifests carry — no exponential notation).

``evidenceHash`` and ``signature.value`` are excluded from the digest (set to the
empty string) exactly as the TypeScript ``stripHashFields`` does.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
from typing import Any

HASH_ALGORITHM = "sha256"


def _format_number(value: int | float) -> str:
    """Format a number exactly as ECMAScript ``JSON.stringify`` would.

    This is the crux of cross-language agreement: JavaScript has a single number
    type, so an integer-valued float like ``0.0`` or ``90.0`` serializes without a
    decimal point (``0``, ``90``). Python's ``repr`` would emit ``0.0``, which
    would hash differently. Non-integer values use Python's shortest round-trip
    ``repr``, equal to JS for the normal-range values a manifest carries.
    """

    if isinstance(value, bool):  # defensive: bool is a subclass of int
        raise TypeError("bool is not a JSON number")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise ValueError(f"non-finite number cannot be canonicalized: {value!r}")
    if value.is_integer() and abs(value) < 1e16:
        return str(int(value))
    return repr(value)


def canonicalize(value: Any) -> str:
    """Return the canonical JSON serialization, matching canonicalize.ts.

    Object keys are sorted, there is no insignificant whitespace, strings use JSON
    escaping, non-ASCII is kept raw, and numbers follow ECMAScript semantics.
    ``None`` maps to ``null`` (JSON has no ``undefined``).
    """

    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _format_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(item) for item in value) + "]"
    if isinstance(value, dict):
        members = [
            json.dumps(key, ensure_ascii=False) + ":" + canonicalize(value[key])
            for key in sorted(value.keys())
        ]
        return "{" + ",".join(members) + "}"
    raise TypeError(f"unsupported value of type {type(value).__name__} in canonicalization")


def strip_hash_fields(manifest: dict[str, Any]) -> dict[str, Any]:
    """Return a copy with the self-referential hash fields blanked out."""

    clone = copy.deepcopy(manifest)
    clone["evidenceHash"] = ""
    signature = clone.get("signature")
    if isinstance(signature, dict):
        signature["value"] = ""
    return clone


def compute_evidence_hash(manifest: dict[str, Any]) -> str:
    """Compute the ``sha256:<hex>`` digest for a manifest."""

    canonical = canonicalize(strip_hash_fields(manifest))
    digest = hashlib.new(HASH_ALGORITHM, canonical.encode("utf-8")).hexdigest()
    return f"{HASH_ALGORITHM}:{digest}"
