import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PolicyError, loadPolicy } from "../src/load.js";

const POLICIES_DIR = join(import.meta.dirname, "../../../policies");

describe("loadPolicy", () => {
  it("applies defaults, including failing closed on unverifiable rules", () => {
    const policy = loadPolicy('version: "1.0"');

    expect(policy.onUnverifiable).toBe("fail");
    expect(policy.exceptions).toEqual([]);
  });

  it("rejects a malformed version", () => {
    expect(() => loadPolicy('version: "1"')).toThrow(PolicyError);
  });

  it("rejects unknown keys instead of ignoring a typo", () => {
    let issues: string[] = [];
    try {
      loadPolicy('version: "1.0"\nsecuriy:\n  secretsAllowed: false\n');
    } catch (err) {
      issues = (err as PolicyError).issues;
    }
    expect(issues.join(" ")).toMatch(/securiy/);
  });

  it("refuses an exception with no reason or approver", () => {
    const yaml = `
version: "1.0"
exceptions:
  - rule: security.secretsAllowed
`;
    expect(() => loadPolicy(yaml)).toThrow(PolicyError);
  });

  it("reports the offending path so a typo is a one-line fix", () => {
    let issues: string[] = [];
    try {
      loadPolicy('version: "1.0"\ntests:\n  minChangedLinesCoverage: 150\n');
    } catch (err) {
      issues = (err as PolicyError).issues;
    }
    expect(issues.join(" ")).toContain("tests.minChangedLinesCoverage");
  });

  it("rejects an empty document", () => {
    expect(() => loadPolicy("")).toThrow(/empty/);
  });

  it("loads the policies shipped with the repository", () => {
    for (const name of ["default.yml", "strict.yml"]) {
      const policy = loadPolicy(readFileSync(join(POLICIES_DIR, name), "utf8"));
      expect(policy.version).toBe("1.0");
      expect(policy.risk.maxAutomaticApprovalScore).toBeGreaterThanOrEqual(0);
    }
  });
});
