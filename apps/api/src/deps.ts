import type { Storage } from "@proofforge/database";
import type { Config } from "./config.js";
import type { EventBus } from "./events.js";
import type { AnalysisRunner } from "./services/analysis-runner.js";

export interface AppDeps {
  storage: Storage;
  events: EventBus;
  runner: AnalysisRunner;
  config: Config;
}
