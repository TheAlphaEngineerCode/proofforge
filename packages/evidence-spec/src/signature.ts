/**
 * Ed25519 signing and verification for proof-manifests.
 *
 * The signature covers the manifest's `evidenceHash` string (a `sha256:<hex>`
 * digest). Because that digest already binds the full document, signing it is
 * equivalent to signing the whole manifest while keeping the signed payload
 * small and stable. Keys are provided in PEM or raw base64 form.
 */
import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { computeEvidenceHash } from "./hash.js";
import type { Manifest } from "./schema.js";

function toPrivateKey(key: string | KeyObject): KeyObject {
  if (typeof key !== "string") return key;
  if (key.includes("-----BEGIN")) return createPrivateKey(key);
  // raw 32-byte seed, base64 → wrap in PKCS8
  const seed = Buffer.from(key, "base64");
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

function toPublicKey(key: string | KeyObject): KeyObject {
  if (typeof key !== "string") return key;
  if (key.includes("-----BEGIN")) return createPublicKey(key);
  const raw = Buffer.from(key, "base64");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

/** Sign a manifest's evidence hash, returning the base64 signature value. */
export function signEvidenceHash(evidenceHash: string, privateKey: string | KeyObject): string {
  const signature = edSign(null, Buffer.from(evidenceHash, "utf8"), toPrivateKey(privateKey));
  return signature.toString("base64");
}

export type SignatureStatus = "valid" | "invalid" | "unsigned" | "no-key";

export interface SignatureVerification {
  status: SignatureStatus;
  valid: boolean;
}

/**
 * Verify a manifest's ed25519 signature.
 *
 * - `unsigned`: the manifest carries no signature value (allowed for local runs).
 * - `no-key`: a signature exists but no public key was supplied to check it.
 * - `valid` / `invalid`: cryptographic result over the recomputed evidence hash.
 */
export function verifySignature(
  manifest: Manifest,
  publicKey?: string | KeyObject,
): SignatureVerification {
  const value = manifest.signature.value;
  if (!value) return { status: "unsigned", valid: false };
  if (!publicKey) return { status: "no-key", valid: false };

  const evidenceHash = computeEvidenceHash(manifest);
  const ok = edVerify(
    null,
    Buffer.from(evidenceHash, "utf8"),
    toPublicKey(publicKey),
    Buffer.from(value, "base64"),
  );
  return { status: ok ? "valid" : "invalid", valid: ok };
}
