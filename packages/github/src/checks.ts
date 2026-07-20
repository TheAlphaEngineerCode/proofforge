/**
 * Turning evidence into a GitHub Check Run verdict.
 *
 * The verdict is derived deterministically from the manifest — never from a
 * model's opinion — so the same evidence always yields the same conclusion.
 */
import type { Manifest } from "@proofforge/evidence-spec";
import { inlineText } from "./markdown.js";
import { measured } from "./provenance.js";

export type CheckConclusion = "success" | "failure" | "neutral";

export interface CheckRunResult {
  conclusion: CheckConclusion;
  title: string;
  summary: string;
}

export interface Verdict {
  conclusion: CheckConclusion;
  /** Findings that force a failure, in the order they were evaluated. */
  blocking: string[];
  headline: string;
}

/** Risk at or below this score may pass without human review. */
const AUTO_APPROVAL_MAX_RISK = 20;

export function evaluateManifest(manifest: Manifest): Verdict {
  const blocking: string[] = [];

  if (manifest.tests.failed > 0) {
    blocking.push(`${manifest.tests.failed} failing test(s)`);
  }
  if (manifest.security.secretsDetected > 0) {
    blocking.push(`${manifest.security.secretsDetected} secret(s) detected`);
  }
  if (manifest.security.criticalVulnerabilities > 0) {
    blocking.push(`${manifest.security.criticalVulnerabilities} critical vulnerability(ies)`);
  }
  // Name the rules. A count tells a reviewer that something is wrong without
  // telling them what to fix, and the rule name is the only part they can act on.
  for (const violation of manifest.policies.failed) {
    blocking.push(`policy ${inlineText(violation.rule)}`);
  }
  if (manifest.operations.migrationsDetected && !manifest.operations.migrationsReversible) {
    blocking.push("irreversible migration");
  }

  if (blocking.length > 0) {
    return { conclusion: "failure", blocking, headline: "Blocked — evidence shows failures" };
  }
  if (manifest.risk.score <= AUTO_APPROVAL_MAX_RISK) {
    return { conclusion: "success", blocking, headline: "Verified — low risk" };
  }
  return { conclusion: "neutral", blocking, headline: "Human approval recommended" };
}

export function mapManifestToCheckRun(manifest: Manifest): CheckRunResult {
  const verdict = evaluateManifest(manifest);
  const { tests, security, risk, policies } = manifest;

  // Every number here is paired with whether anyone produced it. A zero from a
  // scan that never ran is not a clean result, and printing it as one is the
  // failure this whole product argues against.
  const lines = [
    `**Risk ${risk.score}/100 — ${risk.level}**`,
    "",
    `- Tests: ${measured(manifest, "tests", () => `${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped`).text}`,
    `- Coverage on changed lines: ${measured(manifest, "coverage", () => `${tests.coverage.changedLines}%`).text}`,
    `- Vulnerabilities: ${measured(manifest, "vulnerabilities", () => `${security.criticalVulnerabilities} critical, ${security.highVulnerabilities} high`).text}`,
    `- Secrets: ${measured(manifest, "secrets", () => `${security.secretsDetected} detected`).text}`,
    `- SBOM: ${security.sbomGenerated ? "generated" : "not generated"}`,
  ];

  if (policies.failed.length > 0) {
    lines.push("", "**Policy violations**");
    for (const violation of policies.failed) {
      lines.push(`- \`${inlineText(violation.rule)}\` — ${inlineText(violation.message)}`);
    }
  }

  // Warnings are usually rules that could not be evaluated at all. Leaving them
  // out would let a rule nobody checked pass for a rule that was satisfied.
  if (policies.warnings.length > 0) {
    lines.push("", "**Policy warnings**");
    for (const warning of policies.warnings) {
      lines.push(`- \`${inlineText(warning.rule)}\` — ${inlineText(warning.message)}`);
    }
  }

  lines.push(
    "",
    verdict.blocking.length > 0
      ? `**Blocking:** ${verdict.blocking.join("; ")}.`
      : "No blocking findings.",
    "",
    `Evidence hash: \`${manifest.evidenceHash}\``,
  );

  return { conclusion: verdict.conclusion, title: verdict.headline, summary: lines.join("\n") };
}
