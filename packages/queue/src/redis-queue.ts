/**
 * The distributed queue, backed by BullMQ over Redis.
 *
 * The API enqueues and returns; one or more worker processes elsewhere pull the
 * jobs and run them. BullMQ gives us the two properties this phase is about for
 * free: a job id that is already present is not added again (idempotent
 * delivery), and a handler that throws is retried with backoff before the job is
 * finally marked failed.
 */
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { AnalysisJob } from "@proofforge/shared-types";
import type { JobHandler, JobQueue } from "./types.js";

const QUEUE_NAME = "proofforge-analyses";

export interface RedisJobQueueOptions {
  readonly url: string;
  /** Attempts before a job is left failed. Retries use exponential backoff. */
  readonly attempts?: number;
  /** How many jobs one worker runs at once. Ignored until process() is called. */
  readonly concurrency?: number;
}

export class RedisJobQueue implements JobQueue {
  readonly #connection: Redis;
  readonly #queue: Queue<AnalysisJob>;
  readonly #attempts: number;
  readonly #concurrency: number;
  #worker: Worker<AnalysisJob> | undefined;

  constructor(options: RedisJobQueueOptions) {
    // BullMQ requires this on any connection a worker blocks on, and sharing one
    // setting across the queue and worker keeps them from disagreeing.
    this.#connection = new Redis(options.url, { maxRetriesPerRequest: null });
    // An ioredis client is an EventEmitter, and an `error` with no listener is
    // rethrown — a Redis restart or a network blip would take the whole process
    // down for something ioredis will reconnect through on its own. Log and let
    // it recover.
    this.#connection.on("error", (error: Error) => {
      console.warn(`[queue] redis connection error: ${error.message}`);
    });
    this.#queue = new Queue<AnalysisJob>(QUEUE_NAME, { connection: this.#connection });
    this.#attempts = Math.max(1, options.attempts ?? 3);
    this.#concurrency = Math.max(1, options.concurrency ?? 1);
  }

  async enqueue(job: AnalysisJob): Promise<void> {
    await this.#queue.add("analysis", job, {
      // The analysis id as the job id is what makes a re-delivery a no-op.
      jobId: job.analysisId,
      attempts: this.#attempts,
      backoff: { type: "exponential", delay: 1000 },
      // Keep the queue from growing without bound; a modest tail of failures is
      // kept for inspection.
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  process(handler: JobHandler): void {
    if (this.#worker !== undefined) {
      throw new Error("process() called twice: one queue drives one worker");
    }
    const worker = new Worker<AnalysisJob>(
      QUEUE_NAME,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.#connection, concurrency: this.#concurrency },
    );
    // Same reason as the connection: an unlistened `error` on the worker is
    // rethrown. A job that throws is BullMQ's own retry path, not this — this is
    // for the worker's infrastructure faults.
    worker.on("error", (error: Error) => {
      console.warn(`[queue] worker error: ${error.message}`);
    });
    this.#worker = worker;
  }

  settle(_analysisId: string): Promise<void> {
    // A worker's progress lives in another process; there is nothing local to
    // await. The caller treats this as best-effort and reads the analysis record
    // for the settled state.
    return Promise.resolve();
  }

  async close(): Promise<void> {
    // Worker first so it stops pulling new jobs before the connection drops.
    await this.#worker?.close();
    await this.#queue.close();
    await this.#connection.quit();
  }
}
