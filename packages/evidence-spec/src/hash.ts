/**
 * Evidence hashing.
 *
 * The `evidenceHash` binds every field of the manifest except the two that
 * cannot exist yet at hashing time: `evidenceHash` itself and `signature.value`.
 * Those are set to the empty string before canonicalization, so verifying a
 * manifest is deterministic and independent of who produced it.
 */
import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize.js";

export const HASH_ALGORITHM = "sha256" as const;

type Hashable = Record<string, unknown> & {
  evidenceHash?: unknown;
  signature?: Record<string, unknown>;
};

/**
 * Returns the manifest object stripped of the fields excluded from hashing.
 * Does not mutate the input.
 */
export function stripHashFields<T extends Hashable>(manifest: T): T {
  const clone = structuredClone(manifest);
  clone.evidenceHash = "";
  if (clone.signature && typeof clone.signature === "object") {
    clone.signature = { ...clone.signature, value: "" };
  }
  return clone;
}

/** Compute the canonical `sha256:<hex>` digest for a manifest. */
export function computeEvidenceHash(manifest: Hashable): string {
  const canonical = canonicalize(stripHashFields(manifest));
  const digest = createHash(HASH_ALGORITHM).update(canonical, "utf8").digest("hex");
  return `${HASH_ALGORITHM}:${digest}`;
}

export interface HashVerification {
  valid: boolean;
  expected: string;
  actual: string;
}

/** Verify that a manifest's stored `evidenceHash` matches its recomputed value. */
export function verifyEvidenceHash(manifest: Hashable): HashVerification {
  const expected = computeEvidenceHash(manifest);
  const actual = typeof manifest.evidenceHash === "string" ? manifest.evidenceHash : "";
  return { valid: expected === actual, expected, actual };
}
