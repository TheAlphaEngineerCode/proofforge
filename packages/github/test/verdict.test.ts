import { describe, expect, it } from "vitest";
import { evaluateManifest, mapManifestToCheckRun } from "../src/checks.js";
import { COMMENT_MARKER, isProofForgeComment, renderPullRequestComment } from "../src/comment.js";
import { buildManifest } from "@proofforge/test-fixtures";

describe("evaluateManifest", () => {
  it("passes clean, low-risk evidence", () => {
    const verdict = evaluateManifest(buildManifest());
    expect(verdict.conclusion).toBe("success");
    expect(verdict.blocking).toEqual([]);
  });

  it("asks for human approval when risk is above the automatic threshold", () => {
    const verdict = evaluateManifest(buildManifest({ risk: { score: 37, level: "moderate", categories: {}, reasons: [] } }));
    expect(verdict.conclusion).toBe("neutral");
    expect(verdict.headline).toMatch(/human approval/i);
  });

  it.each([
    ["failing tests", { tests: { passed: 10, failed: 3, skipped: 0, durationMs: 1, coverage: { total: 80, changedLines: 80 }, reports: [] } }],
    ["secrets", { security: { criticalVulnerabilities: 0, highVulnerabilities: 0, mediumVulnerabilities: 0, lowVulnerabilities: 0, secretsDetected: 1, sbomGenerated: true, sbomUrl: "", reports: [] } }],
    ["critical vulnerabilities", { security: { criticalVulnerabilities: 2, highVulnerabilities: 0, mediumVulnerabilities: 0, lowVulnerabilities: 0, secretsDetected: 0, sbomGenerated: true, sbomUrl: "", reports: [] } }],
    ["irreversible migration", { operations: { migrationsDetected: true, migrationsReversible: false, rollbackAvailable: true, downtimeRequired: false } }],
  ])("blocks on %s", (_label, overrides) => {
    const verdict = evaluateManifest(buildManifest(overrides as never));
    expect(verdict.conclusion).toBe("failure");
    expect(verdict.blocking.length).toBeGreaterThan(0);
  });

  it("renders a check run carrying the evidence hash", () => {
    const manifest = buildManifest();
    const check = mapManifestToCheckRun(manifest);
    expect(check.conclusion).toBe("success");
    expect(check.summary).toContain(manifest.evidenceHash);
    expect(check.summary).toContain("184 passed");
  });
});

describe("renderPullRequestComment", () => {
  it("summarizes clean evidence and carries the update marker", () => {
    const body = renderPullRequestComment(buildManifest());
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("ProofForge Verification");
    expect(body).toContain("✓ 184 tests passed");
    expect(body).toContain("✓ 92.4% coverage on changed lines");
    expect(body).toContain("✓ No secrets detected");
    expect(body).toContain("Overall risk: 15/100 — low");
    expect(isProofForgeComment(body)).toBe(true);
  });

  it("flags failures and warnings", () => {
    const body = renderPullRequestComment(
      buildManifest({
        tests: { passed: 10, failed: 2, skipped: 0, durationMs: 1, coverage: { total: 40, changedLines: 40 }, reports: [] },
        security: { criticalVulnerabilities: 1, highVulnerabilities: 3, mediumVulnerabilities: 0, lowVulnerabilities: 0, secretsDetected: 1, sbomGenerated: false, sbomUrl: "", reports: [] },
        operations: { migrationsDetected: true, migrationsReversible: false, rollbackAvailable: false, downtimeRequired: true },
      } as never),
    );
    expect(body).toContain("✗ 2 tests failed");
    expect(body).toContain("⚠ 40% coverage on changed lines");
    expect(body).toContain("✗ 1 secrets detected");
    expect(body).toContain("✗ 1 critical vulnerabilities");
    expect(body).toContain("⚠ 3 high vulnerabilities");
    expect(body).toContain("✗ Irreversible migration");
    expect(body).toContain("⚠ Deployment requires downtime");
    expect(body).toMatch(/Blocked/i);
  });

  it("does not treat a foreign comment as its own", () => {
    expect(isProofForgeComment("looks good to me")).toBe(false);
    expect(isProofForgeComment(null)).toBe(false);
  });
});
