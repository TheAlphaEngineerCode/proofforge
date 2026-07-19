import { describe, expect, it } from "vitest";
import { renderPullRequestComment } from "../src/comment.js";
import { buildManifest } from "./fixtures.js";

describe("pull request comment — unmeasured evidence", () => {
  it("does not present an absent test run as a pass", () => {
    const manifest = buildManifest({
      tests: {
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 0,
        coverage: { total: 0, changedLines: 0 },
        reports: [],
      },
    });

    const body = renderPullRequestComment(manifest);

    expect(body).not.toContain("✓ 0 tests passed");
    expect(body).toContain("No tests were executed");
    // A 0% coverage line is meaningless with no test run, so it is dropped.
    expect(body).not.toContain("0% coverage on changed lines");
  });

  it("reports a real test run normally", () => {
    const manifest = buildManifest({
      tests: {
        passed: 12,
        failed: 0,
        skipped: 0,
        durationMs: 500,
        coverage: { total: 91, changedLines: 88 },
        reports: [],
      },
    });

    const body = renderPullRequestComment(manifest);

    expect(body).toContain("✓ 12 tests passed");
    expect(body).toContain("88% coverage on changed lines");
  });

  it("reports failures as failures", () => {
    const manifest = buildManifest({
      tests: {
        passed: 8,
        failed: 3,
        skipped: 0,
        durationMs: 500,
        coverage: { total: 70, changedLines: 65 },
        reports: [],
      },
    });

    const body = renderPullRequestComment(manifest);

    expect(body).toContain("✗ 3 tests failed (8 passed)");
  });
});
