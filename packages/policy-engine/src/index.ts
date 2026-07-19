/**
 * @proofforge/policy-engine
 *
 * Loads YAML policies and decides whether a manifest satisfies them. A rule whose
 * evidence was never collected does not pass by default — silence is not
 * compliance.
 */
export {
  PolicySchema,
  UnverifiableHandling,
  type Policy,
  type PolicyInput,
  type PolicyException,
} from "./schema.js";

export { loadPolicy, PolicyError } from "./load.js";

export {
  evaluatePolicy,
  type PolicyReport,
  type RuleOutcome,
  type Decision,
  type Severity,
} from "./evaluate.js";
