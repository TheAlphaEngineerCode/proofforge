import {
  validateManifestStructure,
  type Manifest,
} from "@proofforge/evidence-spec";
import { ExitCode } from "../exit-codes.js";
import { readJsonFile } from "../io.js";
import { fail, heading, jsonBlock, pass, safe, warn, type CommandResult } from "../output.js";

export interface ManifestCommandOptions {
  json?: boolean;
}

/** `proofforge manifest validate <file>` — structural + schema validation. */
export function manifestValidate(path: string, options: ManifestCommandOptions = {}): CommandResult {
  const input = readJsonFile(path);
  const result = validateManifestStructure(input);

  if (options.json) {
    return {
      exitCode: result.valid ? ExitCode.Success : ExitCode.VerificationFailed,
      stdout: jsonBlock({ valid: result.valid, issues: result.issues }),
    };
  }

  if (result.valid) {
    return { exitCode: ExitCode.Success, stdout: pass(`Valid manifest: ${path}`) };
  }

  const lines = [fail(`Invalid manifest: ${path}`), ""];
  for (const issue of result.issues) {
    lines.push(`  ${issue.path}: ${issue.message} (${issue.code})`);
  }
  return { exitCode: ExitCode.VerificationFailed, stdout: lines.join("\n") };
}

/** `proofforge manifest inspect <file>` — human summary of a manifest. */
export function manifestInspect(path: string, options: ManifestCommandOptions = {}): CommandResult {
  const input = readJsonFile(path);
  const result = validateManifestStructure(input);

  if (!result.valid || !result.manifest) {
    if (options.json) {
      return {
        exitCode: ExitCode.VerificationFailed,
        stdout: jsonBlock({ valid: false, issues: result.issues }),
      };
    }
    return {
      exitCode: ExitCode.VerificationFailed,
      stdout: fail(`Cannot inspect an invalid manifest. Run "manifest validate ${path}".`),
    };
  }

  const m = result.manifest;

  if (options.json) {
    return { exitCode: ExitCode.Success, stdout: jsonBlock(summarize(m)) };
  }

  return { exitCode: ExitCode.Success, stdout: renderSummary(m) };
}

function summarize(m: Manifest): Record<string, unknown> {
  return {
    id: m.id,
    specVersion: m.specVersion,
    repository: `${m.repository.owner}/${m.repository.name}`,
    branch: m.change.branch,
    commit: m.change.commit,
    pullRequest: m.change.pullRequest ?? null,
    tests: { passed: m.tests.passed, failed: m.tests.failed, skipped: m.tests.skipped },
    changedLineCoverage: m.tests.coverage.changedLines,
    security: {
      critical: m.security.criticalVulnerabilities,
      high: m.security.highVulnerabilities,
      secrets: m.security.secretsDetected,
    },
    risk: { score: m.risk.score, level: m.risk.level },
    evidenceHash: m.evidenceHash,
    signed: m.signature.value !== "",
  };
}

function renderSummary(m: Manifest): string {
  const s = m.security;
  const repo = safe(`${m.repository.owner}/${m.repository.name}`);

  const lines: string[] = [
    heading(`ProofForge manifest — ${repo}`),
    `  spec version:   ${m.specVersion}`,
    `  change:         ${safe(m.change.title)}`,
    `  branch/commit:  ${safe(m.change.branch)} @ ${safe(m.change.commit.slice(0, 7))}`,
  ];
  if (m.change.pullRequest) lines.push(`  pull request:   #${m.change.pullRequest}`);

  lines.push(
    "",
    pass(`${m.tests.passed} tests passed, ${m.tests.failed} failed, ${m.tests.skipped} skipped`),
    pass(`${m.tests.coverage.changedLines}% coverage on changed lines`),
    s.secretsDetected === 0 ? pass("No secrets detected") : fail(`${s.secretsDetected} secrets detected`),
    s.criticalVulnerabilities === 0 && s.highVulnerabilities === 0
      ? pass("No critical or high vulnerabilities")
      : fail(`${s.criticalVulnerabilities} critical / ${s.highVulnerabilities} high vulnerabilities`),
  );

  if (m.operations.migrationsDetected) {
    lines.push(
      m.operations.migrationsReversible
        ? pass("Migration reversible")
        : warn("Irreversible migration"),
    );
  } else {
    lines.push("  migrations:     none");
  }

  lines.push(
    "",
    `  ${heading(`Risk: ${m.risk.score}/100 — ${m.risk.level}`)}`,
    `  evidence hash:  ${m.evidenceHash}`,
    `  signed:         ${m.signature.value !== "" ? "yes" : "no"}`,
  );

  return lines.join("\n");
}
