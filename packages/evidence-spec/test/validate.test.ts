import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  validateManifestStructure,
  verifyManifest,
} from "../src/validate.js";
import { computeEvidenceHash } from "../src/hash.js";
import { validManifest } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p: string): unknown => JSON.parse(readFileSync(resolve(here, "..", p), "utf8"));

describe("validateManifestStructure", () => {
  it("accepts a valid manifest", () => {
    expect(validateManifestStructure(validManifest()).valid).toBe(true);
  });

  it("rejects the missing-fields example with issues", () => {
    const result = validateManifestStructure(readJson("examples/invalid/missing-fields.json"));
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.path.includes("id"))).toBe(true);
  });

  it("rejects an out-of-range risk score", () => {
    const result = validateManifestStructure(readJson("examples/invalid/bad-risk-score.json"));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.startsWith("risk.score"))).toBe(true);
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    const m = { ...validManifest(), unexpected: true };
    expect(validateManifestStructure(m).valid).toBe(false);
  });
});

describe("verifyManifest", () => {
  it("passes structure + version + hash for a self-consistent manifest", () => {
    const result = verifyManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.versionSupported).toBe(true);
    expect(result.hash?.valid).toBe(true);
    expect(result.signature?.status).toBe("unsigned");
  });

  it("fails when the evidence hash does not match", () => {
    const m = validManifest();
    m.evidenceHash = "sha256:" + "a".repeat(64);
    expect(verifyManifest(m).valid).toBe(false);
  });

  it("fails an unsupported major version", () => {
    const m = validManifest();
    m.specVersion = "2.0.0";
    m.evidenceHash = computeEvidenceHash(m);
    const result = verifyManifest(m);
    expect(result.versionSupported).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("fails when a signature is required but absent", () => {
    const result = verifyManifest(validManifest(), { requireSignature: true });
    expect(result.valid).toBe(false);
  });
});
