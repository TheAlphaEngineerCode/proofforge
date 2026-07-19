/**
 * Wires the concrete dependencies for a running API instance.
 *
 * Storage selection: PostgreSQL when DATABASE_URL is set, otherwise the
 * in-memory backend (local development, tests). Both satisfy the same contract.
 */
import { InMemoryStorage, type Storage } from "@proofforge/database";
import { InstallationTokenProvider, RestGitHubClient } from "@proofforge/github";
import type { Config } from "./config.js";
import type { AppDeps } from "./deps.js";
import { EventBus } from "./events.js";
import { AnalysisRunner } from "./services/analysis-runner.js";
import { GitHubPublisher } from "./services/github-publisher.js";

export function createDeps(config: Config, storage?: Storage): AppDeps {
  const store = storage ?? new InMemoryStorage();
  const events = new EventBus();
  const runner = new AnalysisRunner(store, events, config.pipelineStepMs);
  const publisher = createPublisher(config, store);

  return { storage: store, events, runner, config, ...(publisher ? { publisher } : {}) };
}

/** Only wired when the GitHub App credentials are present. */
function createPublisher(config: Config, storage: Storage): GitHubPublisher | undefined {
  if (config.githubAppId === "" || config.githubPrivateKey === "") return undefined;

  const tokens = new InstallationTokenProvider({
    appId: config.githubAppId,
    privateKey: config.githubPrivateKey,
    apiBaseUrl: config.githubApiBaseUrl,
  });
  const client = new RestGitHubClient({ tokens, apiBaseUrl: config.githubApiBaseUrl });

  return new GitHubPublisher(storage, client, {
    warn: (message) => console.warn(message),
  });
}
