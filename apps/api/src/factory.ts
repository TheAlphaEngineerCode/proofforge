/**
 * Wires the concrete dependencies for a running API instance.
 *
 * Storage selection: PostgreSQL when DATABASE_URL is set, otherwise the
 * in-memory backend (local development, tests). Both satisfy the same contract.
 */
import { InMemoryStorage, type Storage } from "@proofforge/database";
import type { Config } from "./config.js";
import type { AppDeps } from "./deps.js";
import { EventBus } from "./events.js";
import { AnalysisRunner } from "./services/analysis-runner.js";

export function createDeps(config: Config, storage?: Storage): AppDeps {
  const store = storage ?? new InMemoryStorage();
  const events = new EventBus();
  const runner = new AnalysisRunner(store, events, config.pipelineStepMs);
  return { storage: store, events, runner, config };
}
