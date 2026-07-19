/**
 * Policy documents.
 *
 * A policy states what a change must satisfy before it can be approved. Rules are
 * intentionally boring — thresholds and booleans — because a gate whose outcome a
 * reader cannot predict is not a gate, it is a coin toss.
 */
import { z } from "zod";

/** How to treat a rule whose evidence was never collected. */
export const UnverifiableHandling = z.enum(["fail", "warn"]);
export type UnverifiableHandling = z.infer<typeof UnverifiableHandling>;

const SecurityRules = z
  .object({
    maxCriticalVulnerabilities: z.number().int().nonnegative().optional(),
    maxHighVulnerabilities: z.number().int().nonnegative().optional(),
    secretsAllowed: z.boolean().optional(),
    sbomRequired: z.boolean().optional(),
  })
  .strict();

const TestRules = z
  .object({
    maxFailedTests: z.number().int().nonnegative().optional(),
    minChangedLinesCoverage: z.number().min(0).max(100).optional(),
    testsRequired: z.boolean().optional(),
  })
  .strict();

const RiskRules = z
  .object({
    maxAutomaticApprovalScore: z.number().int().min(0).max(100).optional(),
    maxHumanApprovalScore: z.number().int().min(0).max(100).optional(),
  })
  .strict();

const OperationsRules = z
  .object({
    reversibleMigrationsRequired: z.boolean().optional(),
    downtimeAllowed: z.boolean().optional(),
  })
  .strict();

/**
 * A documented, attributed exemption from one rule.
 *
 * Exceptions are the honest way to say "we know, and we accepted it". They demand
 * a reason and a name precisely so that waiving a rule leaves a trace rather than
 * quietly weakening the policy for everyone.
 */
const PolicyException = z
  .object({
    rule: z.string().min(1),
    reason: z.string().min(1, "an exception must say why"),
    approvedBy: z.string().min(1, "an exception must name who approved it"),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type PolicyException = z.infer<typeof PolicyException>;

export const PolicySchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+$/, "use MAJOR.MINOR, for example 1.0"),
    name: z.string().min(1).default("unnamed policy"),
    /**
     * What to do when a rule cannot be evaluated because its evidence was never
     * collected. Defaults to `fail`: a scanner that did not run must not satisfy
     * a security requirement by silence.
     */
    onUnverifiable: UnverifiableHandling.default("fail"),
    security: SecurityRules.default({}),
    tests: TestRules.default({}),
    risk: RiskRules.default({}),
    operations: OperationsRules.default({}),
    exceptions: z.array(PolicyException).default([]),
  })
  .strict();

export type Policy = z.infer<typeof PolicySchema>;
export type PolicyInput = z.input<typeof PolicySchema>;
