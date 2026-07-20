/**
 * The metrics this service publishes, named and described in one place.
 *
 * Declaring them here rather than at each call site is what makes the set
 * reviewable: a metric nobody can find is a metric nobody uses, and a name
 * invented twice becomes two series measuring one thing.
 */
import { Metrics } from "@proofforge/observability";

export const ANALYSES_TOTAL = "proofforge_analyses_total";
export const ANALYSIS_DURATION = "proofforge_analysis_duration_seconds";
export const COLLECTORS_TOTAL = "proofforge_collectors_total";
export const COLLECTOR_DURATION = "proofforge_collector_duration_seconds";

export function createMetrics(): Metrics {
  const metrics = new Metrics();

  metrics.describe(ANALYSES_TOTAL, "Analyses that reached a terminal state, by outcome.");
  metrics.describe(ANALYSIS_DURATION, "Wall time from start to terminal state, in seconds.");
  metrics.describe(
    COLLECTORS_TOTAL,
    // The point of the whole exercise: a collector that never ran is not a
    // clean result, and only a count split by status makes the two distinct.
    "Collector runs, by collector and status (ok, unavailable, error, timeout).",
  );
  metrics.describe(COLLECTOR_DURATION, "Time each collector took, in seconds.");

  return metrics;
}
