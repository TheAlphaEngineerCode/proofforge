/**
 * @proofforge/shared-types — DTOs, the analysis state machine and event types
 * shared across the API and the web dashboard.
 */
export {
  ANALYSIS_STATUSES,
  TERMINAL_STATUSES,
  isTerminal,
  canTransition,
  nextStatuses,
  type AnalysisStatus,
} from "./states.js";

export {
  RiskLevel,
  User,
  Organization,
  Repository,
  Analysis,
  EvidenceBundle,
  Policy,
  CreateOrganizationInput,
  CreateRepositoryInput,
  CreateAnalysisInput,
  CreatePolicyInput,
} from "./dto.js";

export {
  EVENT_SCHEMA_VERSION,
  type AnalysisEvent,
  type AnalysisStatusEvent,
  type AnalysisCompletedEvent,
  type AnalysisErrorEvent,
  type EventPublisher,
  type EventSubscriber,
} from "./events.js";

export { type AnalysisJob, type PublishInstruction } from "./jobs.js";
