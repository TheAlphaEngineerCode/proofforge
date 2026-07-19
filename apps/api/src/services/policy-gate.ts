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

    return { report, finalStatus: STATUS_FOR[report.decision] };
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

type Severity = "info" | "low" | "medium" | "high" | "critical";
