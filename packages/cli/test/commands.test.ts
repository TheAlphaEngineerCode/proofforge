import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ManifestSchema,
  computeEvidenceHash,
  signEvidenceHash,
  type Manifest,
  type ManifestInput,
} from "@proofforge/evidence-spec";
import { manifestInspect, manifestValidate } from "../src/commands/manifest.js";
import { evidenceVerify } from "../src/commands/evidence.js";
import { ExitCode } from "../src/exit-codes.js";

let dir: string;

function baseInput(): ManifestInput {
  return {
    specVersion: "1.0.0",
    id: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
    repository: { provider: "github", owner: "pf", name: "ex", url: "https://github.com/pf/ex" },
    change: {
      commit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      baseCommit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      branch: "feature/x",
      pullRequest: 42,
      title: "Example",
      request: "task",
      type: "agent",
    },
    environment: {
      runnerVersion: "0.1.0",
      operatingSystem: "linux",
      containerImage: "img@sha256:abc",
      runtimeVersions: { node: "20.11.0" },
      dependencyLockHashes: {},
    },
    tests: { passed: 10, failed: 0, skipped: 0, durationMs: 100, coverage: { total: 90, changedLines: 95 } },
    security: {
      criticalVulnerabilities: 0,
      highVulnerabilities: 0,
      mediumVulnerabilities: 0,
      lowVulnerabilities: 0,
      secretsDetected: 0,
      sbomGenerated: true,
    },
    quality: { complexityBefore: 1, complexityAfter: 1, duplicatedLinesPercentage: 0 },
    performance: { benchmarks: [] },
    operations: {
      migrationsDetected: false,
      migrationsReversible: true,
      rollbackAvailable: true,
      downtimeRequired: false,
    },
    risk: { score: 20, level: "low" },
    policies: {},
    evidenceHash: "sha256:" + "0".repeat(64),
    signature: { algorithm: "ed25519", publicKeyId: "", value: "" },
    createdAt: "2026-07-18T12:00:00.000Z",
  };
}

function writeManifest(name: string, m: Manifest): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(m, null, 2), "utf8");
  return path;
}

function validManifest(): Manifest {
  const m = ManifestSchema.parse(baseInput());
  m.evidenceHash = computeEvidenceHash(m);
  return m;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "proofforge-cli-"));
});

describe("manifest validate", () => {
  it("returns success for a valid manifest", () => {
    const path = writeManifest("valid.json", validManifest());
    const res = manifestValidate(path);
    expect(res.exitCode).toBe(ExitCode.Success);
    expect(res.stdout).toContain("Valid manifest");
  });

  it("returns VerificationFailed with issues for a broken manifest", () => {
    const broken = { ...validManifest(), risk: { score: 200, level: "low" } };
    const path = writeManifest("broken.json", broken as unknown as Manifest);
    const res = manifestValidate(path, { json: true });
    expect(res.exitCode).toBe(ExitCode.VerificationFailed);
    const parsed = JSON.parse(res.stdout) as { valid: boolean; issues: unknown[] };
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it("throws a usage error for a missing file", () => {
    expect(() => manifestValidate(join(dir, "nope.json"))).toThrow();
  });
});

describe("manifest inspect", () => {
  it("summarizes a valid manifest", () => {
    const path = writeManifest("inspect.json", validManifest());
    const res = manifestInspect(path);
    expect(res.exitCode).toBe(ExitCode.Success);
    expect(res.stdout).toContain("Risk: 20/100");
    expect(res.stdout).toContain("pf/ex");
  });

  it("strips control and ANSI sequences from untrusted manifest fields", () => {
    const esc = String.fromCharCode(0x1b); // ESC — starts an ANSI escape sequence
    const nul = String.fromCharCode(0x00);
    const m = validManifest();
    m.change.title = `Innocent${esc}[31mTITLE${nul}end`;
    const path = writeManifest("evil.json", m);

    const res = manifestInspect(path);
    expect(res.exitCode).toBe(ExitCode.Success);
    // The injected escape sequence and NUL must be gone from the untrusted field.
    // (Formatting helpers may legitimately emit their own escape codes, so we
    // assert on the injected sequence specifically, not on any ESC at all.)
    expect(res.stdout).not.toContain(`${esc}[31m`);
    expect(res.stdout).not.toContain(nul);
    expect(res.stdout).toContain("Innocent[31mTITLEend");
  });

  it("emits JSON summary with --json", () => {
    const path = writeManifest("inspect2.json", validManifest());
    const res = manifestInspect(path, { json: true });
    const parsed = JSON.parse(res.stdout) as { repository: string; signed: boolean };
    expect(parsed.repository).toBe("pf/ex");
    expect(parsed.signed).toBe(false);
  });
});

describe("evidence verify", () => {
  it("verifies a self-consistent unsigned manifest", () => {
    const path = writeManifest("verify.json", validManifest());
    const res = evidenceVerify(path);
    expect(res.exitCode).toBe(ExitCode.Success);
    expect(res.stdout).toContain("VERIFIED");
  });

  it("fails on a tampered evidence hash", () => {
    const m = validManifest();
    m.tests.passed = 999; // hash no longer matches
    const path = writeManifest("tampered.json", m);
    const res = evidenceVerify(path, { json: true });
    expect(res.exitCode).toBe(ExitCode.VerificationFailed);
    const parsed = JSON.parse(res.stdout) as { valid: boolean; hash: { valid: boolean } };
    expect(parsed.valid).toBe(false);
    expect(parsed.hash.valid).toBe(false);
  });

  it("verifies a signed manifest with the matching public key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const m = validManifest();
    m.evidenceHash = computeEvidenceHash(m);
    m.signature.value = signEvidenceHash(m.evidenceHash, privateKey);
    const manifestPath = writeManifest("signed.json", m);

    const pubPath = join(dir, "pub.pem");
    writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }) as string, "utf8");

    const res = evidenceVerify(manifestPath, { publicKey: pubPath, requireSignature: true });
    expect(res.exitCode).toBe(ExitCode.Success);
    expect(res.stdout).toContain("Signature valid");
  });

  it("fails when --require-signature but manifest is unsigned", () => {
    const path = writeManifest("unsigned.json", validManifest());
    const res = evidenceVerify(path, { requireSignature: true });
    expect(res.exitCode).toBe(ExitCode.VerificationFailed);
  });
});
