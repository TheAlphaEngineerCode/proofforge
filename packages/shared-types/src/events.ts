/**
 * Real-time analysis events, streamed to the dashboard over Server-Sent Events.
 * Versioned so consumers can evolve independently.
 */
import type { AnalysisStatus } from "./states.js";

export const EVENT_SCHEMA_VERSION = 1;

export interface AnalysisStatusEvent {
  version: number;
  type: "status";
  analysisId: string;
  status: AnalysisStatus;
  previousStatus: AnalysisStatus | null;
  at: string;
}

export interface AnalysisCompletedEvent {
  version: number;
  type: "completed";
  analysisId: string;
  status: AnalysisStatus;
  riskScore: number | null;
  evidenceBundleId: string | null;
  at: string;
}

export interface AnalysisErrorEvent {
  version: number;
  type: "error";
  analysisId: string;
  message: string;
  at: string;
}

export type AnalysisEvent = AnalysisStatusEvent | AnalysisCompletedEvent | AnalysisErrorEvent;

/** Anything that can emit an analysis event: the pipeline publishes, and it does
 *  not care whether the other side is an in-process bus or a Redis channel. */
export interface EventPublisher {
  publish(analysisId: string, event: AnalysisEvent): void;
}

/** The read side: an SSE connection subscribes to one analysis and unsubscribes
 *  when the client goes away. */
export interface EventSubscriber {
  subscribe(analysisId: string, listener: (event: AnalysisEvent) => void): () => void;
}
