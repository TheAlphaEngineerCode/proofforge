/**
 * The unit of work a worker pulls off the queue.
 *
 * A job is plain, serialisable data because it has to survive a round trip
 * through Redis and come out the other side in a different process. It carries
 * the analysis to run and, when the run was triggered by a GitHub event, where
 * to report the result — the publish that used to happen in-process, right after
 * the run, now travels with the job so the worker can do it.
 */

/** Where to report an analysis result back to GitHub. */
export interface PublishInstruction {
  readonly owner: string;
  readonly repo: string;
  readonly installationId: number;
  readonly headSha: string;
  /** Present for pull requests; absent for plain pushes. */
  readonly pullRequest?: number;
  /** Add the pull-request comment without creating a second check run, for a
   *  re-delivery of a commit whose check run already exists. */
  readonly commentOnly?: boolean;
}

export interface AnalysisJob {
  readonly analysisId: string;
  /** Absent for a manually-triggered analysis, which has nowhere to report to. */
  readonly publish?: PublishInstruction;
}
