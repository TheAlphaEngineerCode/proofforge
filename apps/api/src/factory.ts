/**
 * Wires the concrete dependencies for a running API instance, and the worker.
 *
 * Two seams are chosen from configuration, each the same shape: storage is
 * PostgreSQL when DATABASE_URL is set and in-memory otherwise; the queue is
 * Redis when REDIS_URL is set and in-process otherwise. With neither set the
 * whole system is one process with no external dependencies — the default that
 * keeps local development and tests hermetic.
 */
import {
  DrizzleStorage,
  InMemoryStorage,
  createDbClient,
  type Storage,
} from "@proofforge/database";
import { InstallationTokenProvider, RestGitHubClient } from "@proofforge/github";
import { InMemoryJobQueue, RedisEventBus, RedisJobQueue } from "@proofforge/queue";
import type { EventPublisher } from "@proofforge/shared-types";
import type { Metrics } from "@proofforge/observability";
import type { Config } from "./config.js";
import type { AppDeps } from "./deps.js";
import { createMetrics } from "./observability.js";
import { EventBus } from "./events.js";
import {
  AnalysisRunner,
  type EvidencePipeline,
  type RunnerLogger,
} from "./services/analysis-runner.js";
import { createAnalysisJobHandler } from "./services/analysis-job.js";
import { GitRepositoryCheckout } from "./services/checkout.js";
import { PythonEvidenceProducer } from "./services/evidence-producer.js";
import { GitHubPublisher } from "./services/github-publisher.js";
import { PolicyGate } from "./services/policy-gate.js";

export function createDeps(config: Config, storage?: Storage): AppDeps {
  const store = storage ?? createStorage(config);
  const events = new EventBus();
  const metrics = createMetrics();
  const logger: RunnerLogger = { warn: (message) => console.warn(message) };
  const publisher = createPublisher(config, store);
  const base = { storage: store, events, config, metrics, ...(publisher ? { publisher } : {}) };

  if (isDistributed(config)) {
    // The API enqueues; workers elsewhere run the jobs. Their events arrive over
    // Redis and are bridged into the local bus, so the SSE route keeps
    // subscribing to the same in-memory bus and never learns Redis exists.
    const queue = new RedisJobQueue({ url: config.redisUrl });
    const redisEvents = new RedisEventBus(config.redisUrl);
    void redisEvents.bridgeTo((id, event) => events.publish(id, event));
    const close = async (): Promise<void> => {
      await queue.close();
      await redisEvents.close();
    };
    return { ...base, queue, close };
  }

  // Single process: run jobs here and publish straight to the local bus.
  const runner = createRunner(config, store, events, metrics, logger);
  const queue = new InMemoryJobQueue();
  queue.process(createAnalysisJobHandler(runner, publisher));
  return { ...base, queue, close: () => queue.close() };
}

export interface WorkerHandle {
  /** Begin consuming jobs. */
  start(): void;
  /** Stop consuming and release connections. */
  stop(): Promise<void>;
}

/**
 * The worker half of a distributed deployment: it holds the runner and pulls
 * jobs off Redis, publishing pipeline events back over Redis for the API to
 * relay. It shares every piece of wiring with the API through `createRunner`;
 * only the ends of the queue and the event bus differ.
 */
export function createWorker(config: Config, storage?: Storage): WorkerHandle {
  if (!isDistributed(config)) {
    throw new Error("the worker needs REDIS_URL: without it the API runs jobs in-process");
  }
  const store = storage ?? createStorage(config);
  const metrics = createMetrics();
  const logger: RunnerLogger = { warn: (message) => console.warn(message) };
  const publisher = createPublisher(config, store);
  const events = new RedisEventBus(config.redisUrl);
  const runner = createRunner(config, store, events, metrics, logger);
  const queue = new RedisJobQueue({ url: config.redisUrl });

  return {
    start: () => queue.process(createAnalysisJobHandler(runner, publisher)),
    stop: async () => {
      await queue.close();
      await events.close();
    },
  };
}

/** True when a Redis URL is configured, which is what turns on distribution. */
function isDistributed(config: Config): config is Config & { redisUrl: string } {
  return config.redisUrl !== undefined && config.redisUrl !== "";
}

/** The pipeline runner. Shared so the in-process queue and the worker build it identically. */
function createRunner(
  config: Config,
  storage: Storage,
  events: EventPublisher,
  metrics: Metrics,
  logger: RunnerLogger,
): AnalysisRunner {
  return new AnalysisRunner(
    storage,
    events,
    config.pipelineStepMs,
    createEvidencePipeline(config),
    logger,
    new PolicyGate(storage, logger),
    metrics,
  );
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
