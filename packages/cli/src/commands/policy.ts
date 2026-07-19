/**
 * `proofforge policy validate` and `proofforge policy evaluate`.
 *
 * Validation is the fast check you run in an editor loop; evaluation answers the
 * question that matters — would this manifest be allowed through?
 */
import { ManifestSchema } from "@proofforge/evidence-spec";
import { PolicyError, evaluatePolicy, loadPolicy, type RuleOutcome } from "@proofforge/policy-engine";
import { ExitCode } from "../exit-codes.js";
import { readJsonFile, readTextFile } from "../io.js";
import { fail, heading, jsonBlock, pass, safe, warn, type CommandResult } from "../output.js";

export interface PolicyCommandOptions {
  json?: boolean;
}

export function policyValidate(path: string, options: PolicyCommandOptions = {}): CommandResult {
  const source = readTextFile(path);

  try {
    const policy = loadPolicy(source);
    if (options.json) {
      return {
        exitCode: ExitCode.Success,
        stdout: jsonBlock({ valid: true, name: policy.name, version: policy.version }),
      };
    }
    return {
      exitCode: ExitCode.Success,
      stdout: pass(`Valid policy: ${safe(policy.name)} (version ${safe(policy.version)})`),
    };
  } catch (err) {
    if (!(err instanceof PolicyError)) throw err;

    if (options.json) {
      return {
        exitCode: ExitCode.VerificationFailed,
        stdout: jsonBlock({ valid: false, error: err.message, issues: err.issues }),
      };
    }
    const lines = [fail(`${err.message}: ${safe(path)}`)];
    for (const issue of err.issues) lines.push(`    ${safe(issue)}`);
    return { exitCode: ExitCode.VerificationFailed, stdout: lines.join("\n") };
  }
}

export function policyEvaluate(
  policyPath: string,
  manifestPath: string,
  options: PolicyCommandOptions = {},
): CommandResult {
  const policy = loadPolicy(readTextFile(policyPath));
  const manifest = ManifestSchema.parse(readJsonFile(manifestPath));
  const report = evaluatePolicy(policy, manifest);

  // Blocked is a verification failure; needing a human is not — it is the system
  // working as intended, so CI should not go red for it.
  const exitCode =
    report.decision === "blocked" ? ExitCode.VerificationFailed : ExitCode.Success;

  if (options.json) {
    return { exitCode, stdout: jsonBlock(report) };
  }

  const lines = [heading(`Policy: ${safe(report.policy)}`), ""];

  for (const outcome of report.passed) lines.push(pass(safe(`${outcome.rule}: ${outcome.message}`)));
  for (const outcome of report.warnings) lines.push(warn(safe(describe(outcome))));
  for (const outcome of report.failed) lines.push(fail(safe(`${outcome.rule}: ${outcome.message}`)));

  lines.push("", `  ${heading(verdict(report.decision))}`, `  ${safe(report.summary)}`);
  return { exitCode, stdout: lines.join("\n") };
}

function describe(outcome: RuleOutcome): string {
  const suffix = outcome.waivedBy === undefined ? "" : ` (approved by ${outcome.waivedBy})`;
  return `${outcome.rule}: ${outcome.message}${suffix}`;
}

function verdict(decision: string): string {
  if (decision === "blocked") return "BLOCKED";
  if (decision === "human_approval") return "HUMAN APPROVAL REQUIRED";
  return "APPROVED";
}
