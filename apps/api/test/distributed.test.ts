/**
 * The distributed path, end to end, against a real Redis.
 *
 * Every other API test runs the pipeline in-process. This one wires the two
 * halves a real deployment has — an API that only enqueues and bridges events,
 * and a worker that runs the pipeline — and proves a job crosses between them:
 * the API enqueues, a separate worker instance runs the analysis to a terminal
 * state, and the events it publishes arrive back on the API's local bus, which is
 * exactly what the SSE route serves to a browser.
 *
 * The two share an InMemoryStorage the way real processes share a database; only
 * the queue and event bus actually go through Redis. Skipped unless
 * TEST_REDIS_URL is set.
 */
import { InMemoryStorage } from "@proofforge/database";
import type { AnalysisEvent } from "@proofforge/shared-types";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createDeps, createWorker } from "../src/factory.js";

const url = process.env.TEST_REDIS_URL;
const describeWithRedis = url === undefined ? describe.skip : describe;

async function seedAnalysis(storage: InMemoryStorage): Promise<string> {
  const user = await storage.createUser({ name: "u", email: "u@x.com" });
  const org = await storage.createOrganization({ name: "o", slug: "o", ownerId: user.id });
  const repo = await storage.createRepository({
    organizationId: org.id,
    owner: "acme",
    name: "api",
    defaultBranch: "main",
    language: null,
    private: false,
  });
  const analysis = await storage.createAnalysis({
    repositoryId: repo.id,
    commitSha: "abcdef1234567",
  });
  return analysis.id;
}

describeWithRedis("distributed analysis", () => {
  const teardown: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (teardown.length > 0) await teardown.pop()?.();
  });

  it("runs an enqueued analysis in a worker and streams its events back to the API", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PIPELINE_STEP_MS: "0",
      REDIS_URL: url,
    });
    const storage = new InMemoryStorage();

    // The API side: enqueues, and bridges worker events into its local bus.
    const api = createDeps(config, storage);
    teardown.push(() => api.close?.() ?? Promise.resolve());

    // The worker side: holds the runner and consumes the queue.
    const worker = createWorker(config, storage);
    worker.start();
    teardown.push(() => worker.stop());

    const analysisId = await seedAnalysis(storage);

    const received: AnalysisEvent[] = [];
    const completed = new Promise<void>((resolve) => {
      api.events.subscribe(analysisId, (event) => {
        received.push(event);
        if (event.type === "completed") resolve();
      });
    });

    await api.queue.enqueue({ analysisId });
    await completed;

    // The worker drove the state machine: the record is terminal.
    const analysis = await storage.getAnalysis(analysisId);
    expect(analysis?.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
    expect(analysis?.evidenceBundleId).toBeTruthy();

    // And its transitions reached the API's bus over Redis, in order.
    const statuses = received.filter((e) => e.type === "status").map((e) => e.status);
    expect(statuses[0]).toBe("REPOSITORY_ANALYSIS_PENDING");
    expect(statuses.at(-1)).toBe("WAITING_FOR_HUMAN_APPROVAL");
  }, 15_000);
});
