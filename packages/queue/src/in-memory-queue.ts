/**
 * The single-process queue.
 *
 * It runs the handler in the same process that enqueued the job, which is
 * exactly the fire-and-forget behaviour the API had before there was a queue at
 * all: `enqueue` returns immediately and the run proceeds in the background.
 * Tests reach into `wait` to await a specific run without a real event loop
 * delay, the same affordance the old runner offered.
 */
import type { AnalysisJob } from "@proofforge/shared-types";
import type { JobHandler, JobQueue } from "./types.js";

export interface InMemoryJobQueueOptions {
  /** How many times to run a job before giving up. One means no retry. */
  readonly attempts?: number;
}

export class InMemoryJobQueue implements JobQueue {
  #handler: JobHandler | undefined;
  readonly #inflight = new Map<string, Promise<void>>();
  readonly #attempts: number;

  constructor(options: InMemoryJobQueueOptions = {}) {
    this.#attempts = Math.max(1, options.attempts ?? 1);
  }

  process(handler: JobHandler): void {
    if (this.#handler !== undefined) {
      throw new Error("process() called twice: one queue drives one handler");
    }
    this.#handler = handler;
  }

  enqueue(job: AnalysisJob): Promise<void> {
    if (this.#handler === undefined) {
      throw new Error("no handler registered: call process() before enqueue()");
    }
    // Accepting the job is what enqueue resolves; the run itself proceeds in the
    // background, exactly as it did before there was a queue. This matches the
    // Redis backend, where enqueue resolves once the job is added, not once it
    // has run. Callers that need the outcome await wait().
    if (!this.#inflight.has(job.analysisId)) {
      const handler = this.#handler;
      const run = this.#runWithRetry(handler, job).finally(() =>
        this.#inflight.delete(job.analysisId),
      );
      this.#inflight.set(job.analysisId, run);
    }
    return Promise.resolve();
  }

  /** Await an in-flight run; resolves immediately if there is none. */
  settle(analysisId: string): Promise<void> {
    return this.#inflight.get(analysisId) ?? Promise.resolve();
  }

  async close(): Promise<void> {
    // Let whatever is running finish rather than cutting it off mid-write.
    await Promise.allSettled([...this.#inflight.values()]);
  }

  async #runWithRetry(handler: JobHandler, job: AnalysisJob): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await handler(job);
        return;
      } catch (error) {
        // The last attempt's failure is swallowed rather than rejected: the run
        // is fire-and-forget, so a rejection here would surface as an unhandled
        // promise rejection with nowhere to be caught. The handler owns marking
        // the analysis failed; this only governs whether to try again.
        if (attempt >= this.#attempts) return;
        void error;
      }
    }
  }
}
