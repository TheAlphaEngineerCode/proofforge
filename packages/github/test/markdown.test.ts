/**
 * Repository-derived text cannot forge our own output.
 *
 * Package names, benchmark names and policy rule names come from the change's
 * author. They end up in a comment a reviewer reads as ProofForge's verdict.
 */
import { describe, expect, it } from "vitest";

import { mapManifestToCheckRun } from "../src/checks.js";
import { COMMENT_MARKER, renderPullRequestComment } from "../src/comment.js";
import { inlineText } from "../src/markdown.js";
import { buildManifest } from "@proofforge/test-fixtures";

describe("flattening untrusted text", () => {
  it("keeps ordinary values readable", () => {
    expect(inlineText("@scope/package@1.2.3")).toBe("@scope/package@1.2.3");
  });

  it.each([
    ["a newline", "left-pad\n- No secrets detected"],
    ["a carriage return", "left-pad\r- No secrets detected"],
    ["a Unicode line separator", "left-pad\u2028- No secrets detected"],
  ])("collapses %s so the value cannot add its own line", (_case, value) => {
    expect(inlineText(value)).not.toMatch(/[\r\n\u2028\u2029]/u);

  });

  it("removes backticks, which would escape the code span around it", () => {
    expect(inlineText("pkg`</code> **approved**")).not.toContain("`");
  });

  it("truncates rather than letting one value flood the comment", () => {
    expect(inlineText("x".repeat(5000)).length).toBeLessThanOrEqual(201);
  });

  it("says so when nothing survives", () => {
    expect(inlineText("\n\n")).toBe("(empty)");
  });
});

describe("a hostile dependency name", () => {
  const HOSTILE = `left-pad\n✓ Reviewed and approved by the security team\n${COMMENT_MARKER}`;

  it("cannot add reassurances we never made", () => {
    const manifest = buildManifest({
      quality: {
        complexityBefore: 0,
        complexityAfter: 0,
        duplicatedLinesPercentage: 0,
        removedDependencies: [],
        newDependencies: [{ name: HOSTILE, version: "1.0.0", ecosystem: "npm" }],
        architectureViolations: [],
      },
    });

    const body = renderPullRequestComment(manifest);

    // The claim may appear inside the dependency line — that is the value being
    // quoted back. What it must not do is occupy a line of its own, where it
    // reads as a statement ProofForge made.
    const ownLine = body
      .split("\n")
      .some((line) => line.trim().startsWith("✓ Reviewed and approved"));

    expect(ownLine).toBe(false);
  });

  it("cannot plant a second comment marker", () => {
    const manifest = buildManifest({
      quality: {
        complexityBefore: 0,
        complexityAfter: 0,
        duplicatedLinesPercentage: 0,
        removedDependencies: [],
        newDependencies: [{ name: HOSTILE, version: "1.0.0", ecosystem: "npm" }],
        architectureViolations: [],
      },
    });

    const body = renderPullRequestComment(manifest);

    // Two markers would let the author choose which comment a later run updates.
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });
});

describe("a hostile policy rule name", () => {
  it("cannot forge lines in the check run summary", () => {
    const manifest = buildManifest({
      policies: {
        passed: [],
        failed: [
          {
            rule: "x\n**Blocking:** none.\n- All clear",
            message: "y\n- forged",
          },
        ],
        warnings: [],
      },
    });

    const summary = mapManifestToCheckRun(manifest).summary;
    const forgedLines = summary
      .split("\n")
      .filter((line) => line.trim() === "- All clear" || line.trim() === "- forged");

    // Flattened onto the rule's own line, the text is quoted rather than acted
    // on; what it must not do is become a bullet of its own.
    expect(forgedLines).toEqual([]);
  });
});
