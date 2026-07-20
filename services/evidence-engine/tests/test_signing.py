"""Signing manifests, and the ordering the hash depends on."""

import base64
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from proofforge_evidence.cli import main
from proofforge_evidence.context import ChangeContext, RepositoryRef
from proofforge_evidence.manifest_builder import build_manifest
from proofforge_evidence.manifest_hash import compute_evidence_hash
from proofforge_evidence.models import ConsolidatedEvidence
from proofforge_evidence.signing import SigningError, load_signer


def write_pem_key(directory: Path) -> Path:
    key = ed25519.Ed25519PrivateKey.generate()
    path = directory / "private.pem"
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    return path


def context() -> ChangeContext:
    return ChangeContext(
        repository=RepositoryRef(owner="acme", name="api", url="https://github.com/acme/api"),
        commit="9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
        base_commit="1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
        branch="main",
        title="Change",
    )


class TestLoadingKeys:
    def test_reads_a_pem_key(self, tmp_path: Path) -> None:
        signer = load_signer(write_pem_key(tmp_path))

        assert len(signer.public_key_id) == 16

    def test_reads_a_raw_base64_seed(self, tmp_path: Path) -> None:
        """The same form the TypeScript signer accepts."""
        seed = ed25519.Ed25519PrivateKey.generate().private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
        path = tmp_path / "key.b64"
        path.write_text(base64.b64encode(seed).decode("ascii"), encoding="utf-8")

        assert load_signer(path).public_key_id

    def test_the_key_id_is_stable_for_the_same_key(self, tmp_path: Path) -> None:
        path = write_pem_key(tmp_path)

        assert load_signer(path).public_key_id == load_signer(path).public_key_id

    def test_a_missing_key_raises_rather_than_signing_nothing(self, tmp_path: Path) -> None:
        with pytest.raises(SigningError, match="could not read"):
            load_signer(tmp_path / "absent.pem")

    def test_a_key_of_the_wrong_size_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "short.b64"
        path.write_text(base64.b64encode(b"too short").decode("ascii"), encoding="utf-8")

        with pytest.raises(SigningError, match="32 bytes"):
            load_signer(path)

    def test_an_error_never_quotes_the_key(self, tmp_path: Path) -> None:
        secret = "SUPERSECRETKEYMATERIAL"
        path = tmp_path / "bad.pem"
        path.write_text(f"-----BEGIN PRIVATE KEY-----\n{secret}\n", encoding="utf-8")

        with pytest.raises(SigningError) as caught:
            load_signer(path)

        assert secret not in str(caught.value)


class TestSigningAManifest:
    def test_an_unsigned_manifest_carries_no_value(self) -> None:
        manifest = build_manifest(context(), ConsolidatedEvidence(), [])

        assert manifest["signature"]["value"] == ""
        assert manifest["signature"]["publicKeyId"] == ""

    def test_the_hash_still_matches_after_signing(self, tmp_path: Path) -> None:
        """The ordering bug this test exists for.

        Only `signature.value` is excluded from the digest. Writing the key id
        after hashing changed a field the hash covers, so the document no longer
        hashed to what had just been signed — and the TypeScript verifier, which
        recomputes, rejected it.
        """
        signer = load_signer(write_pem_key(tmp_path))

        manifest = build_manifest(context(), ConsolidatedEvidence(), [], signer=signer)

        assert manifest["evidenceHash"] == compute_evidence_hash(manifest)

    def test_the_signature_verifies_against_the_public_key(self, tmp_path: Path) -> None:
        key_path = write_pem_key(tmp_path)
        signer = load_signer(key_path)
        manifest = build_manifest(context(), ConsolidatedEvidence(), [], signer=signer)

        public = serialization.load_pem_private_key(
            key_path.read_bytes(), password=None
        ).public_key()  # type: ignore[union-attr]
        public.verify(  # type: ignore[union-attr]
            base64.b64decode(manifest["signature"]["value"]),
            manifest["evidenceHash"].encode("utf-8"),
        )

    def test_tampering_after_signing_breaks_the_hash(self, tmp_path: Path) -> None:
        signer = load_signer(write_pem_key(tmp_path))
        manifest = build_manifest(context(), ConsolidatedEvidence(), [], signer=signer)

        manifest["tests"]["passed"] = 999

        assert manifest["evidenceHash"] != compute_evidence_hash(manifest)

    def test_the_key_id_is_recorded_so_a_verifier_can_find_the_key(self, tmp_path: Path) -> None:
        signer = load_signer(write_pem_key(tmp_path))

        manifest = build_manifest(context(), ConsolidatedEvidence(), [], signer=signer)

        assert manifest["signature"]["publicKeyId"] == signer.public_key_id

    def test_the_private_key_never_reaches_the_manifest(self, tmp_path: Path) -> None:
        key_path = write_pem_key(tmp_path)
        signer = load_signer(key_path)
        manifest = build_manifest(context(), ConsolidatedEvidence(), [], signer=signer)

        serialised = json.dumps(manifest)
        private_pem = key_path.read_text(encoding="utf-8")
        body = "".join(
            line for line in private_pem.splitlines() if not line.startswith("-----")
        ).strip()

        assert body not in serialised


class TestTheCommandLine:
    """The guarantee the CLI makes: asking for a signature you cannot get fails."""

    def _args(self, repo: Path, out: Path, key: str) -> list[str]:
        return [
            "build",
            "--repo", str(repo),
            "--owner", "acme", "--name", "api",
            "--url", "https://github.com/acme/api",
            "--commit", "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
            "--base", "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
            "--branch", "main",
            "--output-dir", str(out),
            "--signing-key", key,
        ]

    def test_an_unusable_key_fails_instead_of_writing_an_unsigned_bundle(
        self, tmp_path: Path, capsys
    ) -> None:
        repo = tmp_path / "repo"
        repo.mkdir()
        out = tmp_path / "bundle"

        exit_code = main(self._args(repo, out, str(tmp_path / "missing.pem")))

        assert exit_code == 2
        # No bundle at all: a caller who asked for a signature gets nothing
        # rather than something they would assume was signed.
        assert not (out / "proof-manifest.json").exists()
        assert "could not read the signing key" in capsys.readouterr().err

    def test_the_error_does_not_quote_the_key(self, tmp_path: Path, capsys) -> None:
        repo = tmp_path / "repo"
        repo.mkdir()
        secret = "NOTAREALKEYBUTSECRETLOOKING"
        bad = tmp_path / "bad.pem"
        bad.write_text("-----BEGIN PRIVATE KEY-----\n" + secret + "\n", encoding="utf-8")

        assert main(self._args(repo, tmp_path / "b", str(bad))) == 2
        assert secret not in capsys.readouterr().err
