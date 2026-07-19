/**
 * The pull-request comment.
 *
 * Carries a hidden marker so subsequent runs update the same comment instead of
 * appending a new one on every push.
 */
import type { Manifest } from "@proofforge/evidence-spec";
import { evaluateManifest } from "./checks.js";

export const COMMENT_MARKER = "<!-- proofforge:verification -->";

const pass = (text: string): string => `✓ ${text}`;
const warn = (text: string): string => `⚠ ${text}`;
const fail = (text: string): string => `✗ ${text}`;

export function renderPullRequestComment(manifest: Manifest): string {
  const { tests, security, quality, performance, operations, risk } = manifest;
  const verdict = evaluateManifest(manifest);
  const lines: string[] = [];

  lines.push(
    tests.failed === 0
      ? pass(`${tests.passed} tests passed`)
      : fail(`${tests.failed} tests failed (${tests.passed} passed)`),
  );
  lines.push(
    tests.coverage.changedLines >= 80
      ? pass(`${tests.coverage.changedLines}% coverage on changed lines`)
      : warn(`${tests.coverage.changedLines}% coverage on changed lines`),
  );
  lines.push(
    security.secretsDetected === 0
      ? pass("No secrets detected")
      : fail(`${security.secretsDetected} secrets detected`),
  );
  lines.push(
    security.criticalVulnerabilities === 0
      ? pass("No critical vulnerabilities")
      : fail(`${security.criticalVulnerabilities} critical vulnerabilities`),
  );
  if (security.highVulnerabilities > 0) {
    lines.push(warn(`${security.highVulnerabilities} high vulnerabilities`));
  }

  const worstBenchmark = [...performance.benchmarks].sort(
    (a, b) => b.regressionPercentage - a.regressionPercentage,
  )[0];
  if (worstBenchmark) {
    const text = `${worstBenchmark.name}: ${worstBenchmark.regressionPercentage}% latency change`;
    lines.push(worstBenchmark.regressionPercentage <= 5 ? pass(text) : warn(text));
  }

  if (operations.migrationsDetected) {
    lines.push(
      operations.migrationsReversible
        ? pass("Migration reversible")
        : fail("Irreversible migration"),
    );
  }
  if (operations.downtimeRequired) lines.push(warn("Deployment requires downtime"));

  for (const dependency of quality.newDependencies) {
    lines.push(warn(`New dependency added: ${dependency}`));
  }
  if (quality.architectureViolations.length > 0) {
    lines.push(warn(`${quality.architectureViolations.length} architecture violation(s)`));
  }

  return [
    COMMENT_MARKER,
    "## ProofForge Verification",
    "",
    ...lines,
    "",
    `**Overall risk: ${risk.score}/100 — ${risk.level}**`,
    "",
    `**Result: ${verdict.headline}**`,
    "",
    `<sub>Commit \`${manifest.change.commit.slice(0, 7)}\` · evidence \`${manifest.evidenceHash.slice(0, 23)}…\`</sub>`,
  ].join("\n");
}

/** Whether a comment body was produced by ProofForge (used to update in place). */
export function isProofForgeComment(body: string | null | undefined): boolean {
  return typeof body === "string" && body.includes(COMMENT_MARKER);
}
