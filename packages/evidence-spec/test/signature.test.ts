import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeEvidenceHash } from "../src/hash.js";
import { signEvidenceHash, verifySignature } from "../src/signature.js";
import { validManifest } from "./fixtures.js";

describe("signature", () => {
  it("reports unsigned manifests", () => {
    const result = verifySignature(validManifest());
    expect(result.status).toBe("unsigned");
    expect(result.valid).toBe(false);
  });

  it("reports no-key when a signature exists but no key is provided", () => {
    const m = validManifest();
    m.signature.value = "abc";
    expect(verifySignature(m).status).toBe("no-key");
  });

  it("signs and verifies with a generated ed25519 key pair", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const m = validManifest();
    m.evidenceHash = computeEvidenceHash(m);
    m.signature.value = signEvidenceHash(m.evidenceHash, privateKey);

    const result = verifySignature(m, publicKey);
    expect(result.status).toBe("valid");
    expect(result.valid).toBe(true);
  });

  it("signs and verifies using raw base64 keys (not PEM)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    // Extract the raw 32-byte seed / public key from the DER encodings.
    const seed = (privateKey.export({ type: "pkcs8", format: "der" }) as Buffer).subarray(16);
    const rawPub = (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(12);

    const m = validManifest();
    m.evidenceHash = computeEvidenceHash(m);
    m.signature.value = signEvidenceHash(m.evidenceHash, seed.toString("base64"));

    const result = verifySignature(m, rawPub.toString("base64"));
    expect(result.status).toBe("valid");
  });

  it("detects an invalid signature after tampering", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const m = validManifest();
    m.evidenceHash = computeEvidenceHash(m);
    m.signature.value = signEvidenceHash(m.evidenceHash, privateKey);

    m.tests.passed = 123; // changes recomputed evidence hash → signature no longer matches
    expect(verifySignature(m, publicKey).status).toBe("invalid");
  });
});
