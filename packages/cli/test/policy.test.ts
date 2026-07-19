import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestSchema } from "@proofforge/evidence-spec";
import { beforeAll, describe, expect, it } from "vitest";
import { policyEvaluate, policyValidate } from "../src/commands/policy.js";
import { ExitCode } from "../src/exit-codes.js";

let dir: string;

const POLICY = `
version: "1.0"
name: demo
onUnverifiable: warn
security:
  maxCriticalVulnerabilities: 0
risk:
  maxAutomaticApprovalScore: 20
`;

function write(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "proofforge-policy-"));
});

describe("policy validate", () => {
  it("accepts a well-formed policy", () => {
    const res = policyValidate(write("ok.yml", POLICY));
    expect(res.exitCode).toBe(ExitCode.Success);
    expect(res.stdout).toContain("Valid policy");
  });

  it("rejects an invalid one and points at the offending key", () => {
    const res = policyValidate(write("bad.yml", 'version: "1"\n'), { json: true });
    expect(res.exitCode).toBe(ExitCode.VerificationFailed);
    const parsed = JSON.parse(res.stdout) as { valid: boolean; issues: string[] };
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.join(" ")).toContain("version");
  });

  it("fails cleanly on a missing file", () => {
    expect(() => policyValidate(join(dir, "nope.yml"))).toThrow();
  });
});

describe("policy evaluate", () => {
  const manifestPath = () =>
    write(
      "manifest.json",
      JSON.stringify(
        ManifestSchema.parse({
          specVersion: "1.1.0",
          id: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
          repository: { provider: "github", owner: "a", name: "b", url: "https://github.com/a/b" },
          change: {
            commit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
            baseCommit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
            branch: "main",
            title: "t",
            request: "",
            type: "validation",
          },
          environment: {
            runnerVersion: "0.1.0",
            operatingSystem: "linux",
            containerImage: "",
            runtimeVersions: {},
            dependencyLockHashes: {},
          },
          tests: {
            passed: 5,
            failed: 0,
            skipped: 0,
            durationMs: 10,
            coverage: { total: 95, changedLines: 95 },
          },
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
          risk: { score: 12, level: "low", categories: {}, reasons: [] },
          policies: {},
          collectors: [
            { name: "tests", status: "ok" },
            { name: "vulnerabilities", status: "ok" },
            { name: "secrets", status: "ok" },
          ],
          evidenceHash: `sha256:${"0".repeat(64)}`,
          signature: { algorithm: "ed25519", publicKeyId: "", value: "" },
          createdAt: "2026-07-19T12:00:00.000Z",
        }),
      ),
    );

  it("approves a clean manifest and exits 0", () => {
    const res = policyEvaluate(write("p.yml", POLICY), manifestPath());
    expect(res.exitCode).toBe(ExitCode.Success);
    expect(res.stdout).toContain("APPROVED");
  });

  it("blocks and exits non-zero when a rule fails", () => {
    const strict = `
version: "1.0"
name: strict
tests:
  minChangedLinesCoverage: 99
risk:
  maxAutomaticApprovalScore: 20
`;
    const res = policyEvaluate(write("strict.yml", strict), manifestPath(), { json: true });
    expect(res.exitCode).toBe(ExitCode.VerificationFailed);
    const report = JSON.parse(res.stdout) as { decision: string };
    expect(report.decision).toBe("blocked");
  });
});
