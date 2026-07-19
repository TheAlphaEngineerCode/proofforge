/**
 * High-level validation API used by the CLI and services.
 *
 * Validation happens in layers:
 *   1. structural — the document matches the Zod schema;
 *   2. version    — the declared specVersion is supported;
 *   3. integrity  — the recomputed evidence hash matches the stored one;
 *   4. signature  — (optional) the ed25519 signature verifies against a key.
 *
 * Each layer is reported independently so callers can decide how strict to be.
 */
import type { KeyObject } from "node:crypto";
import { ManifestSchema, type Manifest } from "./schema.js";
import { verifyEvidenceHash, type HashVerification } from "./hash.js";
import { verifySignature, type SignatureVerification } from "./signature.js";
import { isSupportedSpecVersion } from "./version.js";

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface StructuralResult {
  valid: boolean;
  issues: ValidationIssue[];
  manifest?: Manifest;
}

/** Parse and structurally validate an unknown value against the manifest schema. */
export function validateManifestStructure(input: unknown): StructuralResult {
  const result = ManifestSchema.safeParse(input);
  if (result.success) {
    return { valid: true, issues: [], manifest: result.data };
  }
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
    code: issue.code,
  }));
  return { valid: false, issues };
}

export interface VerifyOptions {
  /** Public key (PEM or raw base64) to verify the ed25519 signature. */
  publicKey?: string | KeyObject;
  /** Require a valid signature; an unsigned or unverifiable manifest fails. */
  requireSignature?: boolean;
}

export interface VerifyResult {
  valid: boolean;
  structure: StructuralResult;
  versionSupported: boolean;
  hash?: HashVerification;
  signature?: SignatureVerification;
  manifest?: Manifest;
}

/**
 * Full verification: structure + version + integrity hash + optional signature.
 * `valid` is true only when every required layer passes.
 */
export function verifyManifest(input: unknown, options: VerifyOptions = {}): VerifyResult {
  const structure = validateManifestStructure(input);
  if (!structure.valid || !structure.manifest) {
    return { valid: false, structure, versionSupported: false };
  }

  const manifest = structure.manifest;
  const versionSupported = isSupportedSpecVersion(manifest.specVersion);
  const hash = verifyEvidenceHash(manifest);
  const signature = verifySignature(manifest, options.publicKey);

  const signatureOk = options.requireSignature ? signature.valid : signature.status !== "invalid";

  const valid = structure.valid && versionSupported && hash.valid && signatureOk;

  return { valid, structure, versionSupported, hash, signature, manifest };
}
