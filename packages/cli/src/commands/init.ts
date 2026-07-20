/**
 * `proofforge init` — write a starting policy into the repository it governs.
 *
 * The policy is the thing that decides whether a change is allowed through, so
 * it belongs in version control next to the code, reviewed like the code. This
 * writes one worth reading rather than an empty file: every rule carries the
 * reason it is set where it is, because a policy nobody understands gets
 * loosened the first time it says no.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadPolicy } from "@proofforge/policy-engine";
import { ExitCode } from "../exit-codes.js";
import { fail, pass, safe, warn, type CommandResult } from "../output.js";

export const POLICY_FILENAME = "proofforge-policy.yml";

export interface InitOptions {
  /** Overwrite an existing policy. Off by default: it may be the real one. */
  force?: boolean;
  /** Where to write. Defaults to the working directory. */
  cwd?: string;
}

/**
 * `onUnverifiable: warn` rather than `fail` on purpose.
 *
 * `fail` is the safer setting and what a mature setup should reach, but a
 * repository adopting ProofForge usually has no scanners installed yet — so
 * `fail` would block every change on day one and the policy would be deleted
 * rather than tightened. The comment says which direction to move and when.
 */
const TEMPLATE = `# ProofForge policy — decides whether a change may pass without a human.
# Keep this in version control: it governs this repository and should be
# reviewed like anything else that can block a merge.
version: "1.0"
name: starter

# What to do when a rule cannot be evaluated because its collector never ran.
# "fail" is the safe setting: a scanner that did not run has cleared nothing.
# It starts at "warn" because a repository adopting ProofForge usually has no
# scanners installed yet, and a policy that blocks everything on day one gets
# deleted instead of tightened. Move to "fail" once your collectors run in CI.
onUnverifiable: warn

security:
  # A critical vulnerability is not a judgement call.
  maxCriticalVulnerabilities: 0
  maxHighVulnerabilities: 5
  # A committed secret is compromised the moment it is pushed, whatever happens next.
  secretsAllowed: false
  sbomRequired: false

tests:
  maxFailedTests: 0
  testsRequired: true
  # Coverage of the lines this change added, not of the repository. A well
  # tested project can still add untested code.
  minChangedLinesCoverage: 70

operations:
  # A dropped column is not recoverable by redeploying the previous release.
  reversibleMigrationsRequired: true
  downtimeAllowed: false

risk:
  # At or below this, ProofForge approves on its own.
  maxAutomaticApprovalScore: 20
  # Above this, no amount of human approval is enough — the change is reworked.
  maxHumanApprovalScore: 75

# Exceptions waive a rule for a named person and a stated reason, and are
# recorded in the audit log every time they apply. Give them an expiry:
#
# exceptions:
#   - rule: security.sbomRequired
#     reason: SBOM tooling lands next sprint
#     approvedBy: you@example.com
#     expiresAt: "2026-12-31T00:00:00Z"
`;

export function init(options: InitOptions = {}): CommandResult {
  const target = resolve(options.cwd ?? process.cwd(), POLICY_FILENAME);

  // Parsed before anything is written. Checking afterwards would leave a broken
  // policy on disk and then complain about it, which is a worse outcome than
  // refusing — the file is what someone reaches for next.
  try {
    loadPolicy(TEMPLATE);
  } catch (err) {
    return {
      exitCode: ExitCode.VerificationFailed,
      stdout: fail(`The built-in policy template does not parse: ${safe(String(err))}`),
    };
  }

  try {
    // "wx" fails if the file exists, so the check and the write are one step.
    // Testing first and writing second leaves a window in which a policy someone
    // just added gets overwritten by a command that promised not to.
    writeFileSync(target, TEMPLATE, { encoding: "utf8", flag: options.force === true ? "w" : "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // The file on disk may be the policy actually governing this repository.
      return {
        exitCode: ExitCode.UsageError,
        stdout: [
          fail(`${POLICY_FILENAME} already exists`),
          warn("Pass --force to overwrite it."),
        ].join("\n"),
      };
    }
    return {
      exitCode: ExitCode.UsageError,
      stdout: fail(`Could not write ${POLICY_FILENAME}: ${safe(String(err))}`),
    };
  }

  return {
    exitCode: ExitCode.Success,
    stdout: [
      pass(`Wrote ${safe(target)}`),
      "",
      "  Review it, commit it, then check a manifest against it:",
      `    proofforge policy evaluate ${POLICY_FILENAME} ./bundle/proof-manifest.json`,
    ].join("\n"),
  };
}
