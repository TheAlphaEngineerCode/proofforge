/**
 * What running one queued job means, in one place both the in-process queue and
 * the worker use.
 *
 * A job is: run the analysis to completion, then — if it came from a GitHub
 * event — report the result. The publish used to happen in the webhook route,
 * chained onto the run's promise; moving it here is what lets the run and its
 * report both happen in the worker, out of the request's lifetime.
 *
 * The runner and publisher each swallow their own failures, so this resolves for
 * any outcome they handled. A throw that escapes here is an infrastructure fault
 * — the queue's cue to retry the job, not a verdict about the change.
 */
import type { AnalysisJob } from "@proofforge/shared-types";
import type { JobHandler } from "@proofforge/queue";
import type { AnalysisRunner } from "./analysis-runner.js";
import type { GitHubPublisher } from "./github-publisher.js";

export function createAnalysisJobHandler(
  runner: AnalysisRunner,
  publisher?: GitHubPublisher,
): JobHandler {
  return async (job: AnalysisJob): Promise<void> => {
    await runner.start(job.analysisId);
    if (job.publish !== undefined && publisher !== undefined) {
      await publisher.publish(job.publish, job.analysisId);
    }
  };
}
