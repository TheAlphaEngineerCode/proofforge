/**
 * What a reviewer is told about policy, on both surfaces.
 *
 * The verdict is decided by the policy, so a reviewer who cannot see which rule
 * failed has a conclusion and nothing to act on. And a rule that could not be
 * evaluated must never be silently absent — an unchecked rule would then read
 * exactly like a satisfied one.
 */
import { describe, expect, it } from "vitest";

import { mapManifestToCheckRun, evaluateManifest } from "../src/checks.js";
import { renderPullRequestComment } from "../src/comment.js";
import { buildManifest } from "@proofforge/test-fixtures";

const VIOLATION = {
  rule: "security.maxCriticalVulnerabilities",
  message: "2 critical vulnerabilities exceed the maximum of 0",
};

const UNEVALUATED = {
  rule: "security.secretsAllowed",
  message: "cannot be evaluated: the secrets collector did not run",
};

describe("policy violations reach the reviewer", () => {
  it("names the violated rule in the comment, not just a count", () => {
    const manifest = buildManifest({
      policies: { passed: [], failed: [VIOLATION], warnings: [] },
    });

    const body = renderPullRequestComment(manifest);

    expect(body).toContain(VIOLATION.rule);
    expect(body).toContain(VIOLATION.message);
  });

  it("names the violated rule in the check run summary", () => {
    const manifest = buildManifest({
      policies: { passed: [], failed: [VIOLATION], warnings: [] },
    });

    expect(mapManifestToCheckRun(manifest).summary).toContain(VIOLATION.rule);
  });

  it("names the rule in the blocking list rather than counting violations", () => {
    const manifest = buildManifest({
      policies: { passed: [], failed: [VIOLATION], warnings: [] },
    });

    const verdict = evaluateManifest(manifest);

    expect(verdict.conclusion).toBe("failure");
    expect(verdict.blocking.join(" ")).toContain(VIOLATION.rule);
  });
});

describe("rules that could not be evaluated", () => {
  it("appears in the comment instead of passing quietly", () => {
    const manifest = buildManifest({
      policies: { passed: [], failed: [], warnings: [UNEVALUATED] },
    });

    const body = renderPullRequestComment(manifest);

    expect(body).toContain(UNEVALUATED.rule);
    expect(body).toContain("cannot be evaluated");
  });

  it("appears in the check run summary too", () => {
    const manifest = buildManifest({
      policies: { passed: [], failed: [], warnings: [UNEVALUATED] },
    });

    expect(mapManifestToCheckRun(manifest).summary).toContain("cannot be evaluated");
  });
});

describe("the check run does not present unmeasured evidence as clean", () => {
  it("says a scan was not measured rather than reporting zero", () => {
    const manifest = buildManifest({
      collectors: [{ name: "tests", status: "ok", detail: "", durationMs: 10 }],
      security: {
        reports: [],
        criticalVulnerabilities: 0,
        highVulnerabilities: 0,
        mediumVulnerabilities: 0,
        lowVulnerabilities: 0,
        secretsDetected: 0,
        sbomGenerated: false,
        sbomUrl: "",
      },
    });

    const summary = mapManifestToCheckRun(manifest).summary;

    // The old summary read "Secrets detected: 0" for a scan that never ran.
    expect(summary).not.toMatch(/Secrets: 0 detected/);
    expect(summary).toMatch(/Secrets: not measured/);
    expect(summary).toMatch(/Vulnerabilities: not measured/);
  });

  it("still reports a real zero as a real zero", () => {
    // Every collector ran in the default fixture, so these are measurements.
    const summary = mapManifestToCheckRun(buildManifest()).summary;

    expect(summary).toMatch(/Secrets: 0 detected/);
  });
});


describe("operations evidence nobody gathered", () => {
  const NO_OPERATIONS_COLLECTOR = [
    { name: "tests", status: "ok" as const, detail: "", durationMs: 10 },
  ];

  it("does not report migrations as safe when nothing looked", () => {
    // The defaults assert safety: migrationsDetected false, migrationsReversible
    // true. Reading them without provenance turns silence into reassurance.
    const manifest = buildManifest({ collectors: NO_OPERATIONS_COLLECTOR });

    const body = renderPullRequestComment(manifest);

    expect(body).toMatch(/Migrations and rollback were not checked/);
    expect(body).not.toMatch(/Migration reversible/);
  });

  it("cannot block on an irreversible migration it never detected", () => {
    // The rule exists and looks like it guards this. Without a collector it can
    // never fire, so the guarantee it implies is not one.
    const manifest = buildManifest({
      collectors: NO_OPERATIONS_COLLECTOR,
      operations: {
        migrationsDetected: false,
        migrationsReversible: true,
        rollbackAvailable: true,
        downtimeRequired: false,
      },
    });

    expect(evaluateManifest(manifest).blocking).not.toContain("irreversible migration");
    // ...and the comment says why, rather than implying it was checked.
    expect(renderPullRequestComment(manifest)).toContain("not checked");
  });

  it("still blocks when a collector did look and found one", () => {
    const manifest = buildManifest({
      collectors: [
        ...NO_OPERATIONS_COLLECTOR,
        { name: "operations", status: "ok" as const, detail: "", durationMs: 5 },
      ],
      operations: {
        migrationsDetected: true,
        migrationsReversible: false,
        rollbackAvailable: false,
        downtimeRequired: false,
      },
    });

    expect(evaluateManifest(manifest).blocking).toContain("irreversible migration");
  });
});
