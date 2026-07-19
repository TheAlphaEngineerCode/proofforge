/**
 * The analysis state machine.
 *
 * Every ProofForge analysis (validation or agent mode) moves through this set of
 * states. Transitions are explicit so the orchestrator, the API and the UI all
 * agree on what is legal, and every transition is auditable.
 */

export const ANALYSIS_STATUSES = [
  "CREATED",
  "REPOSITORY_ANALYSIS_PENDING",
  "REPOSITORY_ANALYSIS_RUNNING",
  "PLANNING",
  "WAITING_FOR_PLAN_APPROVAL",
  "IMPLEMENTING",
  "REVIEWING",
  "TESTING",
  "SECURITY_ANALYSIS",
  "PERFORMANCE_ANALYSIS",
  "EVIDENCE_GENERATION",
  "POLICY_VALIDATION",
  "WAITING_FOR_HUMAN_APPROVAL",
  "APPROVED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<AnalysisStatus> = new Set([
  "APPROVED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
]);

export function isTerminal(status: AnalysisStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Allowed transitions. FAILED and CANCELLED are reachable from any non-terminal
 * state (a run can always error out or be cancelled), so they are handled
 * separately in {@link canTransition} rather than listed on every state.
 */
const TRANSITIONS: Record<AnalysisStatus, readonly AnalysisStatus[]> = {
  CREATED: ["REPOSITORY_ANALYSIS_PENDING"],
  REPOSITORY_ANALYSIS_PENDING: ["REPOSITORY_ANALYSIS_RUNNING"],
  REPOSITORY_ANALYSIS_RUNNING: ["PLANNING", "TESTING"],
  PLANNING: ["WAITING_FOR_PLAN_APPROVAL"],
  WAITING_FOR_PLAN_APPROVAL: ["IMPLEMENTING"],
  IMPLEMENTING: ["REVIEWING"],
  REVIEWING: ["TESTING"],
  TESTING: ["SECURITY_ANALYSIS"],
  SECURITY_ANALYSIS: ["PERFORMANCE_ANALYSIS"],
  PERFORMANCE_ANALYSIS: ["EVIDENCE_GENERATION"],
  EVIDENCE_GENERATION: ["POLICY_VALIDATION"],
  POLICY_VALIDATION: ["WAITING_FOR_HUMAN_APPROVAL", "APPROVED", "REJECTED"],
  WAITING_FOR_HUMAN_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: AnalysisStatus, to: AnalysisStatus): boolean {
  if (isTerminal(from)) return false;
  if (to === "FAILED" || to === "CANCELLED") return true;
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: AnalysisStatus): readonly AnalysisStatus[] {
  return TRANSITIONS[from];
}
