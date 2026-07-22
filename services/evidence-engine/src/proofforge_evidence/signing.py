"""Signing a manifest's evidence hash with ed25519.

The signature covers the ``evidenceHash`` string, and that digest already binds
the whole document — so signing it is equivalent to signing the manifest, with a
payload that stays small and stable.

The key is read from a file rather than an environment variable. Environment
variables are visible in process listings, inherited by every child process, and
routinely dumped by crash handlers and CI debug output; a file can be given
permissions. Nothing here logs the key, and no error message quotes its contents.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519


class SigningError(Exception):
    """Raised when signing was asked for and cannot be done."""


@dataclass(frozen=True)
class Signer:
    """An ed25519 private key, plus the identifier a verifier uses to find its pair."""

    signer: ed25519.Ed25519PrivateKey
    public_key_id: str

    def sign(self, evidence_hash: str) -> str:
        """Base64 signature over the hash string, matching the TypeScript signer."""

        return base64.b64encode(self.signer.sign(evidence_hash.encode("utf-8"))).decode("ascii")

    # Deliberately no way to export the public key into the bundle. Shipping it
    # next to the signature would prove nothing — anyone can sign with a key of
    # their own and enclose the matching public half. A verifier has to hold the
    # key already; `public_key_id` is how they tell whether they hold the right
    # one.


def load_signer(key_path: Path) -> Signer:
    """Load a PEM or raw base64 ed25519 private key.

    Any failure raises: signing was requested, so quietly producing an unsigned
    manifest would leave the caller believing in a guarantee they do not have.
    """

    try:
        data = key_path.read_bytes()
    except OSError as err:
        # Report the path, never the contents.
        raise SigningError(f"could not read the signing key at {key_path}: {err.strerror}") from err

    key = _parse_private_key(data, key_path)
    return Signer(signer=key, public_key_id=_key_id(key.public_key()))


def _parse_private_key(data: bytes, key_path: Path) -> ed25519.Ed25519PrivateKey:
    text = data.strip()
    if text.startswith(b"-----BEGIN"):
        try:
            loaded = serialization.load_pem_private_key(text, password=None)
        except (ValueError, TypeError) as err:
            raise SigningError(f"the signing key at {key_path} is not a usable PEM key") from err
        if not isinstance(loaded, ed25519.Ed25519PrivateKey):
            raise SigningError(f"the signing key at {key_path} is not an ed25519 key")
        return loaded

    # Raw 32-byte seed, base64 — the same form the TypeScript signer accepts.
    try:
        seed = base64.b64decode(text, validate=True)
    except (ValueError, TypeError) as err:
        raise SigningError(f"the signing key at {key_path} is neither PEM nor base64") from err
    if len(seed) != 32:
        raise SigningError(
            f"the signing key at {key_path} should be 32 bytes, got {len(seed)}",
        )
    return ed25519.Ed25519PrivateKey.from_private_bytes(seed)


def _key_id(public_key: ed25519.Ed25519PublicKey) -> str:
    """A short, stable name for the key.

    Derived from the public half so it can be published and recomputed by anyone
    holding the same public key — and so it reveals nothing about the private one.
    """

    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return hashlib.sha256(raw).hexdigest()[:16]
