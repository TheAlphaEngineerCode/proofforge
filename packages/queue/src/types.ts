import type { AnalysisJob } from "@proofforge/shared-types";

/** Runs one job to completion. It must not throw for an outcome it handled — a
 *  throw is what tells the queue to retry, so a swallowed failure and a retryable
 *  one have to stay distinct. */
export type JobHandler = (job: AnalysisJob) => Promise<void>;

/**
 * A queue of analyses to run.
 *
 * Two implementations satisfy this: an in-process one for single-process and
 * test runs, and a Redis-backed one for a real deployment where the API only
 * enqueues and separate workers consume. The seam is deliberately the same one
 * the storage layer uses — the caller picks a backend from configuration and
 * writes to the interface.
 */
export interface JobQueue {
  /**
   * Enqueue an analysis. The analysis id is the job id, so enqueuing an id that
   * is already queued or running is a no-op — a webhook re-delivery cannot start
   * the same analysis twice.
   */
  enqueue(job: AnalysisJob): Promise<void>;
  /** Register the one handler that runs jobs. Call once, before enqueueing. */
  process(handler: JobHandler): void;
  /**
   * Resolve once any in-flight processing of this id has settled.
   *
   * In a single process this awaits the run, so a caller can sequence a
   * follow-up (a re-delivery's comment) after it, and tests can await a result.
   * Across processes a worker's progress is not observable from here, so it
   * resolves immediately — the follow-up is best-effort against whatever the
   * analysis record already holds.
   */
  settle(analysisId: string): Promise<void>;
  /** Stop consuming and release connections. */
  close(): Promise<void>;
}
