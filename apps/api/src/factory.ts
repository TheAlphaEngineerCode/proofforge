/**
 * Wires the concrete dependencies for a running API instance.
 *
 * Storage selection: PostgreSQL when DATABASE_URL is set, otherwise the
 * in-memory backend (local development, tests). Both satisfy the same contract.
 */
import {
  DrizzleStorage,
  InMemoryStorage,
  createDbClient,
  type Storage,
} from "@proofforge/database";
import { InstallationTokenProvider, RestGitHubClient } from "@proofforge/github";
import type { Config } from "./config.js";
import type { AppDeps } from "./deps.js";
import { EventBus } from "./events.js";
import { AnalysisRunner, type EvidencePipeline } from "./services/analysis-runner.js";
import { GitRepositoryCheckout } from "./services/checkout.js";
import { PythonEvidenceProducer } from "./services/evidence-producer.js";
import { GitHubPublisher } from "./services/github-publisher.js";
import { PolicyGate } from "./services/policy-gate.js";

export function createDeps(config: Config, storage?: Storage): AppDeps {
  const store = storage ?? createStorage(config);
  const events = new EventBus();
  const logger = { warn: (message: string) => console.warn(message) };
  const runner = new AnalysisRunner(
    store,
    events,
    config.pipelineStepMs,
    createEvidencePipeline(config),
    logger,
    new PolicyGate(store, logger),
  );
  const publisher = createPublisher(config, store);

  return { storage: store, events, runner, config, ...(publisher ? { publisher } : {}) };
}

/** PostgreSQL when DATABASE_URL is set, otherwise the in-memory backend. */
function createStorage(config: Config): Storage {
  if (config.databaseUrl === undefined || config.databaseUrl === "") {
    return new InMemoryStorage();
  }
  return new DrizzleStorage(createDbClient(config.databaseUrl));
}

/** Only wired when the evidence engine's location is configured. */
function createEvidencePipeline(config: Config): EvidencePipeline | undefined {
  if (config.evidenceEngineDir === "") return undefined;
  return {
    checkout: new GitRepositoryCheckout(),
    producer: new PythonEvidenceProducer({ engineDir: config.evidenceEngineDir }),
  };
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
