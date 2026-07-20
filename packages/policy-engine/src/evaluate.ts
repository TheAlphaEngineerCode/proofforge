/**
 * Evaluating a manifest against a policy.
 *
 * The rule that shapes this file: **a rule whose evidence was never collected has
 * not passed.** `maxCriticalVulnerabilities: 0` is trivially satisfied by a
 * scanner that never ran, and treating that as compliance would let a change
 * through by measuring nothing — the failure this project exists to prevent.
 * Such rules are reported as unverifiable and, by default, fail.
 */
import type { Manifest } from "@proofforge/evidence-spec";
import type { Policy, PolicyException } from "./schema.js";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface RuleOutcome {
  rule: string;
  message: string;
  severity: Severity;
  /** Set when the rule was waived by an exception, naming who accepted it. */
  waivedBy?: string;
}

export type Decision = "auto_approve" | "human_approval" | "blocked";

export interface PolicyReport {
  policy: string;
  passed: RuleOutcome[];
  failed: RuleOutcome[];
  warnings: RuleOutcome[];
  decision: Decision;
  /** Why the decision came out this way, in plain words. */
  summary: string;
}

/** Collector names each rule family depends on. */
const REQUIRES: Record<string, string> = {
  "security.maxCriticalVulnerabilities": "vulnerabilities",
  "security.maxHighVulnerabilities": "vulnerabilities",
  "security.secretsAllowed": "secrets",
  "security.sbomRequired": "sbom",
  "tests.maxFailedTests": "tests",
  "tests.testsRequired": "tests",
  // Coverage over the changed lines is measured separately from coverage as a
  // whole, and fails separately too: the report can exist while the diff cannot
  // be read. Pointing this rule at the whole-repository collector would let it
  // pass on a figure that describes code the change never touched.
  "tests.minChangedLinesCoverage": "changed-coverage",
  // The operations defaults assert safety rather than absence:
  // migrationsReversible and rollbackAvailable are true out of the box. Without
  // this, a rule guarding against irreversible migrations passed on a manifest
  // where nothing had looked for one, which is worse than the rule not existing
  // — it reads as a guarantee.
  "operations.reversibleMigrationsRequired": "operations",
  "operations.downtimeAllowed": "operations",
  "operations.rollbackRequired": "operations",
};

export function evaluatePolicy(policy: Policy, manifest: Manifest): PolicyReport {
  const passed: RuleOutcome[] = [];
  const failed: RuleOutcome[] = [];
  const warnings: RuleOutcome[] = [];

  const collectorRan = (name: string): boolean =>
    manifest.collectors.some((entry) => entry.name === name && entry.status === "ok");

  const record = (outcome: RuleOutcome, ok: boolean): void => {
    const exception = findException(policy, outcome.rule);
    if (!ok && exception) {
      warnings.push({
        ...outcome,
        message: `${outcome.message} — waived: ${exception.reason}`,
        waivedBy: exception.approvedBy,
      });
      return;
    }
    (ok ? passed : failed).push(outcome);
  };

  /** Report a rule whose evidence is missing, per the policy's chosen handling. */
  const unverifiable = (rule: string, collector: string, severity: Severity): void => {
    const outcome: RuleOutcome = {
      rule,
      message: `cannot be evaluated: the ${collector} collector did not run`,
      severity,
    };
    const exception = findException(policy, rule);
    if (exception) {
      warnings.push({
        ...outcome,
        message: `${outcome.message} — waived: ${exception.reason}`,
        waivedBy: exception.approvedBy,
      });
    } else if (policy.onUnverifiable === "warn") {
      warnings.push(outcome);
    } else {
      failed.push(outcome);
    }
  };

  const check = (
    rule: string,
    severity: Severity,
    evaluate: () => { ok: boolean; message: string },
  ): void => {
    const collector = REQUIRES[rule];
    if (collector !== undefined && !collectorRan(collector)) {
      unverifiable(rule, collector, severity);
      return;
    }
    const { ok, message } = evaluate();
    record({ rule, message, severity }, ok);
  };

  // ── security ──────────────────────────────────────────────────────────────
  const security = manifest.security;

  if (policy.security.maxCriticalVulnerabilities !== undefined) {
    const limit = policy.security.maxCriticalVulnerabilities;
    check("security.maxCriticalVulnerabilities", "critical", () => ({
      ok: security.criticalVulnerabilities <= limit,
      message: `${security.criticalVulnerabilities} critical vulnerabilities (limit ${limit})`,
    }));
  }

  if (policy.security.maxHighVulnerabilities !== undefined) {
    const limit = policy.security.maxHighVulnerabilities;
    check("security.maxHighVulnerabilities", "high", () => ({
      ok: security.highVulnerabilities <= limit,
      message: `${security.highVulnerabilities} high vulnerabilities (limit ${limit})`,
    }));
  }

  if (policy.security.secretsAllowed === false) {
    check("security.secretsAllowed", "critical", () => ({
      ok: security.secretsDetected === 0,
      message:
        security.secretsDetected === 0
          ? "no secrets detected"
          : `${security.secretsDetected} secrets detected`,
    }));
  }

  if (policy.security.sbomRequired === true) {
    check("security.sbomRequired", "medium", () => ({
      ok: security.sbomGenerated,
      message: security.sbomGenerated ? "SBOM generated" : "no SBOM was generated",
    }));
  }

  // ── tests ─────────────────────────────────────────────────────────────────
  const tests = manifest.tests;
  const totalTests = tests.passed + tests.failed + tests.skipped;

  if (policy.tests.maxFailedTests !== undefined) {
    const limit = policy.tests.maxFailedTests;
    check("tests.maxFailedTests", "high", () => ({
      ok: tests.failed <= limit,
      message: `${tests.failed} failing tests (limit ${limit})`,
    }));
  }

  if (policy.tests.testsRequired === true) {
    check("tests.testsRequired", "high", () => ({
      ok: totalTests > 0,
      message: totalTests > 0 ? `${totalTests} tests ran` : "the test run found no tests",
    }));
  }

  if (policy.tests.minChangedLinesCoverage !== undefined) {
    const floor = policy.tests.minChangedLinesCoverage;
    check("tests.minChangedLinesCoverage", "medium", () => ({
      ok: tests.coverage.changedLines >= floor,
      message: `${tests.coverage.changedLines}% coverage on changed lines (minimum ${floor}%)`,
    }));
  }

  // ── operations ────────────────────────────────────────────────────────────
  const operations = manifest.operations;

  if (policy.operations.reversibleMigrationsRequired === true && operations.migrationsDetected) {
    check("operations.reversibleMigrationsRequired", "high", () => ({
      ok: operations.migrationsReversible,
      message: operations.migrationsReversible
        ? "migrations are reversible"
        : "an irreversible migration was detected",
    }));
  }

  if (policy.operations.downtimeAllowed === false) {
    check("operations.downtimeAllowed", "high", () => ({
      ok: !operations.downtimeRequired,
      message: operations.downtimeRequired
        ? "this change requires downtime"
        : "no downtime required",
    }));
  }

  // ── risk thresholds decide the verdict ────────────────────────────────────
  const score = manifest.risk.score;
  const autoLimit = policy.risk.maxAutomaticApprovalScore;
  const humanLimit = policy.risk.maxHumanApprovalScore;

  if (humanLimit !== undefined && score > humanLimit) {
    failed.push({
      rule: "risk.maxHumanApprovalScore",
      message: `risk ${score} exceeds ${humanLimit}, above what a human may approve`,
      severity: "critical",
    });
  }

  const decision = decide({ failed, score, autoLimit });
  return {
    policy: policy.name,
    passed,
    failed,
    warnings,
    decision,
    summary: explain(decision, failed, warnings, score, autoLimit),
  };
}

function decide(input: {
  failed: RuleOutcome[];
  score: number;
  autoLimit: number | undefined;
}): Decision {
  if (input.failed.length > 0) return "blocked";
  if (input.autoLimit !== undefined && input.score > input.autoLimit) return "human_approval";
  return "auto_approve";
}

function explain(
  decision: Decision,
  failed: RuleOutcome[],
  warnings: RuleOutcome[],
  score: number,
  autoLimit: number | undefined,
): string {
  const waived = warnings.filter((entry) => entry.waivedBy !== undefined).length;
  const waivedNote = waived > 0 ? `, ${waived} waived by exception` : "";

  if (decision === "blocked") {
    return `${failed.length} policy rules failed${waivedNote}`;
  }
  if (decision === "human_approval") {
    return `all rules passed${waivedNote}, but risk ${score} exceeds the ${autoLimit} automatic-approval threshold`;
  }
  return `all rules passed${waivedNote} and risk ${score} is within the automatic-approval threshold`;
}

function findException(policy: Policy, rule: string): PolicyException | undefined {
  const now = Date.now();
  return policy.exceptions.find((entry) => {
    if (entry.rule !== rule) return false;
    // An expired exception is no exception; silence should not outlive its reason.
    if (entry.expiresAt !== undefined && Date.parse(entry.expiresAt) < now) return false;
    return true;
  });
}
