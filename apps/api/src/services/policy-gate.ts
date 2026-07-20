/**
 * Applying an organization's policy to a finished manifest.
 *
 * Policy outcomes belong in the manifest — they are part of the record of why a
 * change was allowed through. Writing them in changes the document, so the
 * evidence hash is stamped again afterwards; a manifest whose hash does not match
 * its contents is worse than useless.
 */
import { computeEvidenceHash, type Manifest } from "@proofforge/evidence-spec";
import type { Storage } from "@proofforge/database";
import {
  PolicyError,
  evaluatePolicy,
  loadPolicy,
  type Decision,
  type PolicyReport,
  type RuleOutcome,
  type Severity,
} from "@proofforge/policy-engine";
import type { AnalysisStatus } from "@proofforge/shared-types";

export interface PolicyGateLogger {
  warn(message: string): void;
}

export interface PolicyGateResult {
  /** Absent when the organization has no active policy. */
  report?: PolicyReport;
  /** Where the analysis should end up. */
  finalStatus: AnalysisStatus;
}

/** How a decision maps onto the terminal state of an analysis. */
const STATUS_FOR: Record<Decision, AnalysisStatus> = {
  auto_approve: "APPROVED",
  human_approval: "WAITING_FOR_HUMAN_APPROVAL",
  blocked: "REJECTED",
};

export class PolicyGate {
  constructor(
    private readonly storage: Storage,
    private readonly logger: PolicyGateLogger,
  ) {}

  /**
   * Evaluate the organization's active policy, record the outcomes in the
   * manifest and report where the analysis should land. Mutates `manifest`.
   */
  async apply(organizationId: string, manifest: Manifest): Promise<PolicyGateResult> {
    const policySource = await this.activePolicy(organizationId);
    if (policySource === null) {
      // No policy configured: nothing to enforce, so a human still looks at it.
      return { finalStatus: "WAITING_FOR_HUMAN_APPROVAL" };
    }

    let report: PolicyReport;
    try {
      report = evaluatePolicy(loadPolicy(policySource), manifest);
    } catch (err) {
      // A policy we cannot parse must not silently approve anything.
      const detail = err instanceof PolicyError ? err.issues.join("; ") || err.message : String(err);
      this.logger.warn(`[policy] active policy is unusable, falling back to human review: ${detail}`);
      return { finalStatus: "WAITING_FOR_HUMAN_APPROVAL" };
    }

    manifest.policies = {
      passed: report.passed.map(toOutcome),
      failed: report.failed.map(toOutcome),
      warnings: report.warnings.map(toOutcome),
    };
    manifest.evidenceHash = computeEvidenceHash(manifest);

    await this.recordWaivers(organizationId, manifest, report);

    return { report, finalStatus: STATUS_FOR[report.decision] };
  }

  /**
   * Write one audit entry per waived rule.
   *
   * The waiver is already in the manifest, but a manifest covers one change. It
   * cannot answer "who keeps waiving this rule, and how often" — and a rule
   * waived every time is a rule nobody is enforcing. That question needs a log
   * that outlives the change.
   *
   * Failing to write the log must not change the verdict: the analysis is
   * finished and correct either way, so this is reported and swallowed.
   */
  private async recordWaivers(
    organizationId: string,
    manifest: Manifest,
    report: PolicyReport,
  ): Promise<void> {
    // Waived rules land in `warnings` today. Scanning every bucket anyway means
    // a change to where the engine files them cannot quietly stop the auditing —
    // a waiver that goes unlogged is precisely the one worth logging.
    const waived = [...report.passed, ...report.warnings, ...report.failed].filter(
      (outcome) => outcome.waivedBy !== undefined,
    );

    for (const outcome of waived) {
      try {
        await this.storage.recordAuditLog({
          organizationId,
          // The approver is named in the policy file, not authenticated here, so
          // this records who the policy says accepted it — not a verified actor.
          actorType: "policy_exception",
          actorId: outcome.waivedBy ?? null,
          action: "policy.rule_waived",
          targetType: "analysis",
          targetId: manifest.id,
          metadata: {
            rule: outcome.rule,
            severity: outcome.severity,
            message: outcome.message,
            commit: manifest.change.commit,
            evidenceHash: manifest.evidenceHash,
          },
        });
      } catch (err) {
        this.logger.warn(
          `[policy] could not record the waiver of ${outcome.rule}: ${String(err)}`,
        );
      }
    }
  }

  private async activePolicy(organizationId: string): Promise<string | null> {
    const policies = await this.storage.listPolicies(organizationId);
    const active = policies.find((policy) => policy.active);
    return active?.content ?? null;
  }
}

/**
 * The manifest's outcome shape has no field for who waived a rule, so the
 * approver goes into the message — an unattributed waiver is not an audit trail.
 */
function toOutcome(outcome: RuleOutcome): { rule: string; message: string; severity: Severity } {
  const message =
    outcome.waivedBy === undefined
      ? outcome.message
      : `${outcome.message} (approved by ${outcome.waivedBy})`;
  return { rule: outcome.rule, message, severity: outcome.severity };
}
