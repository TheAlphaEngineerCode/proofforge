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

  // "No tests ran" is not a pass. Reporting an absent measurement as a green
  // check is the one thing this product must never do — the whole premise is
  // that a change is trusted only on evidence that exists.
  const testsRan = tests.passed + tests.failed + tests.skipped > 0;
  if (!testsRan) {
    lines.push(warn("No tests were executed — behaviour is unverified"));
  } else {
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
  }
  // A zero only means "clean" if the collector actually ran. Manifest provenance
  // (spec 1.1.0) lets us say "not measured" instead of implying a pass.
  const ran = (collector: string): boolean =>
    manifest.collectors.some((entry) => entry.name === collector && entry.status === "ok");

  lines.push(
    !ran("secrets")
      ? warn("Secret scanning did not run — unverified")
      : security.secretsDetected === 0
        ? pass("No secrets detected")
        : fail(`${security.secretsDetected} secrets detected`),
  );
  lines.push(
    !ran("vulnerabilities")
      ? warn("Vulnerability scanning did not run — unverified")
      : security.criticalVulnerabilities === 0
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

  // The policy is what actually decides the verdict, so hiding it leaves the
  // reviewer with a conclusion and no way to see how it was reached — or which
  // rule to fix.
  const policyLines: string[] = [];
  for (const violation of manifest.policies.failed) {
    policyLines.push(fail(`\`${violation.rule}\` — ${violation.message}`));
  }
  for (const warning of manifest.policies.warnings) {
    policyLines.push(warn(`\`${warning.rule}\` — ${warning.message}`));
  }

  const policySection =
    policyLines.length > 0
      ? ["", "### Policy", "", ...policyLines]
      : manifest.policies.passed.length > 0
        ? ["", `<sub>${manifest.policies.passed.length} policy rules passed.</sub>`]
        : [];

  return [
    COMMENT_MARKER,
    "## ProofForge Verification",
    "",
    ...lines,
    ...policySection,
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
