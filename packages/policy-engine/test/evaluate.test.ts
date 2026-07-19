import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/evaluate.js";
import { loadPolicy } from "../src/load.js";
import { buildManifest } from "./fixtures.js";

const policy = (yaml: string) => loadPolicy(yaml);

const BASE = `
version: "1.0"
name: test
security:
  maxCriticalVulnerabilities: 0
  secretsAllowed: false
tests:
  maxFailedTests: 0
  testsRequired: true
risk:
  maxAutomaticApprovalScore: 20
  maxHumanApprovalScore: 75
`;

describe("evaluatePolicy", () => {
  it("approves a clean manifest whose risk is under the threshold", () => {
    const report = evaluatePolicy(policy(BASE), buildManifest());

    expect(report.decision).toBe("auto_approve");
    expect(report.failed).toHaveLength(0);
    expect(report.passed.length).toBeGreaterThan(0);
  });

  it("asks for a human when every rule passes but risk is above the threshold", () => {
    const report = evaluatePolicy(
      policy(BASE),
      buildManifest({ risk: { score: 45, level: "elevated", categories: {}, reasons: [] } }),
    );

    expect(report.decision).toBe("human_approval");
    expect(report.summary).toContain("exceeds the 20");
  });

  it("blocks when a rule fails", () => {
    const report = evaluatePolicy(
      policy(BASE),
      buildManifest({
        security: {
          criticalVulnerabilities: 2,
          highVulnerabilities: 0,
          mediumVulnerabilities: 0,
          lowVulnerabilities: 0,
          secretsDetected: 0,
          sbomGenerated: true,
          sbomUrl: "",
          reports: [],
        },
      }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.failed.map((entry) => entry.rule)).toContain(
      "security.maxCriticalVulnerabilities",
    );
  });

  it("blocks when risk exceeds what a human is allowed to approve", () => {
    const report = evaluatePolicy(
      policy(BASE),
      buildManifest({ risk: { score: 90, level: "critical", categories: {}, reasons: [] } }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.failed.map((entry) => entry.rule)).toContain("risk.maxHumanApprovalScore");
  });
});

describe("rules whose evidence was never collected", () => {
  const unscanned = () =>
    buildManifest({
      collectors: [{ name: "tests", status: "ok", detail: "", durationMs: 5 }],
    });

  it("does not let a scanner that never ran satisfy a security rule", () => {
    const report = evaluatePolicy(policy(BASE), unscanned());

    // Zero criticals were reported, but nothing looked for them.
    expect(report.passed.map((entry) => entry.rule)).not.toContain(
      "security.maxCriticalVulnerabilities",
    );
    expect(report.decision).toBe("blocked");

    const unverifiable = report.failed.find(
      (entry) => entry.rule === "security.maxCriticalVulnerabilities",
    );
    expect(unverifiable?.message).toContain("did not run");
  });

  it("downgrades unverifiable rules to warnings when the policy says so", () => {
    const lenient = policy(`${BASE}\nonUnverifiable: warn\n`);
    const report = evaluatePolicy(lenient, unscanned());

    expect(report.decision).not.toBe("blocked");
    expect(report.warnings.map((entry) => entry.rule)).toContain(
      "security.maxCriticalVulnerabilities",
    );
  });
});

describe("exceptions", () => {
  const withException = `${BASE}
exceptions:
  - rule: security.secretsAllowed
    reason: "test fixture contains a deliberately fake key, tracked in SEC-9"
    approvedBy: "ana.silva"
`;

  const leaking = () =>
    buildManifest({
      security: {
        criticalVulnerabilities: 0,
        highVulnerabilities: 0,
        mediumVulnerabilities: 0,
        lowVulnerabilities: 0,
        secretsDetected: 1,
        sbomGenerated: true,
        sbomUrl: "",
        reports: [],
      },
    });

  it("turns a failure into an attributed warning", () => {
    const report = evaluatePolicy(policy(withException), leaking());

    expect(report.failed).toHaveLength(0);
    const waived = report.warnings.find((entry) => entry.rule === "security.secretsAllowed");
    expect(waived?.waivedBy).toBe("ana.silva");
    expect(waived?.message).toContain("SEC-9");
    expect(report.summary).toContain("1 waived by exception");
  });

  it("ignores an expired exception", () => {
    const expired = `${BASE}
exceptions:
  - rule: security.secretsAllowed
    reason: "temporary"
    approvedBy: "ana.silva"
    expiresAt: "2020-01-01T00:00:00Z"
`;
    const report = evaluatePolicy(policy(expired), leaking());

    expect(report.decision).toBe("blocked");
    expect(report.failed.map((entry) => entry.rule)).toContain("security.secretsAllowed");
  });
});
