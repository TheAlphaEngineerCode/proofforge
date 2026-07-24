import type { Storage } from "@proofforge/database";
import type { Metrics } from "@proofforge/observability";
import type { JobQueue } from "@proofforge/queue";
import type { Config } from "./config.js";
import type { EventBus } from "./events.js";
import type { GitHubPublisher } from "./services/github-publisher.js";

export interface AppDeps {
  storage: Storage;
  events: EventBus;
  /** Where analyses are enqueued. In-process by default, Redis when configured. */
  queue: JobQueue;
  config: Config;
  metrics: Metrics;
  /** Absent when the GitHub App is not configured; webhooks then only record state. */
  publisher?: GitHubPublisher;
  /** Releases queue and event-bridge connections. Present so the server can shut down cleanly. */
  close?: () => Promise<void>;
}
