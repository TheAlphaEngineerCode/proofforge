/**
 * The worker process.
 *
 * Same wiring as the API, minus the HTTP server: it pulls analyses off Redis and
 * runs the pipeline, publishing events back over Redis for the API to relay to
 * connected browsers. Run one or many; BullMQ hands each job to exactly one.
 *
 * It refuses to start without REDIS_URL — a worker with an in-process queue would
 * consume from a queue nothing else can reach, which is a silent no-op, not a
 * degraded mode worth having.
 */
import { loadConfig } from "./config.js";
import { createWorker } from "./factory.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const worker = createWorker(config);
  worker.start();
  process.stdout.write("[proofforge-worker] consuming analyses from the queue\n");

  const shutdown = (signal: string): void => {
    process.stdout.write(`[proofforge-worker] ${signal} received, draining\n`);
    // Bound the drain: a job wedged in a stuck subprocess must not hold the
    // process open until the orchestrator resorts to SIGKILL. Exit non-zero so a
    // forced shutdown is visible rather than looking clean.
    const deadline = setTimeout(() => {
      process.stderr.write("[proofforge-worker] drain timed out, exiting\n");
      process.exit(1);
    }, 30_000);
    deadline.unref();

    worker
      .stop()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        process.stderr.write(`[proofforge-worker] shutdown error: ${String(err)}\n`);
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main().catch((err: unknown) => {
  process.stderr.write(`[proofforge-worker] failed to start: ${String(err)}\n`);
  process.exit(1);
});
