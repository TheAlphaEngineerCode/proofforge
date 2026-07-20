import type { Storage } from "@proofforge/database";
import type { Metrics } from "@proofforge/observability";
import type { Config } from "./config.js";
import type { EventBus } from "./events.js";
import type { AnalysisRunner } from "./services/analysis-runner.js";
import type { GitHubPublisher } from "./services/github-publisher.js";

export interface AppDeps {
  storage: Storage;
  events: EventBus;
  runner: AnalysisRunner;
  config: Config;
  metrics: Metrics;
  /** Absent when the GitHub App is not configured; webhooks then only record state. */
  publisher?: GitHubPublisher;
}
