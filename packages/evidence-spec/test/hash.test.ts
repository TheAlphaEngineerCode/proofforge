import { describe, expect, it } from "vitest";
import { computeEvidenceHash, stripHashFields, verifyEvidenceHash } from "../src/hash.js";
import { validManifest } from "./fixtures.js";

describe("hash", () => {
  it("produces a sha256:<hex> digest", () => {
    const hash = computeEvidenceHash(validManifest());
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is stable across key ordering of the same manifest", () => {
    const m = validManifest();
    // Reverse the top-level key insertion order without dropping any data.
    const reordered = Object.fromEntries(Object.entries(m).reverse());
    expect(computeEvidenceHash(m)).toBe(computeEvidenceHash(reordered));
  });

  it("excludes evidenceHash and signature.value from the digest", () => {
    const m = validManifest();
    const before = computeEvidenceHash(m);
    m.evidenceHash = "sha256:" + "f".repeat(64);
    m.signature.value = "tampered";
    expect(computeEvidenceHash(m)).toBe(before);
  });

  it("does not mutate the input when stripping", () => {
    const m = validManifest();
    const original = m.evidenceHash;
    stripHashFields(m);
    expect(m.evidenceHash).toBe(original);
  });

  it("verifies a self-consistent manifest and detects tampering", () => {
    const m = validManifest();
    expect(verifyEvidenceHash(m).valid).toBe(true);

    m.tests.passed = 999;
    expect(verifyEvidenceHash(m).valid).toBe(false);
  });
});
