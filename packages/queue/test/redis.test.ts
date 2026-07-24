/**
 * The Redis-backed queue and event bus, against a real server.
 *
 * The in-memory suite covers the queue's contract; this one covers the things
 * only a broker decides: that a job crosses a process boundary and comes back
 * intact, that a duplicate id is not run twice, and that an event published on
 * one connection reaches a subscriber on another.
 *
 * Skipped unless TEST_REDIS_URL is set, so the ordinary suite needs no server.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisEvent } from "@proofforge/shared-types";
import { RedisEventBus } from "../src/redis-events.js";
import { RedisJobQueue } from "../src/redis-queue.js";

const url = process.env.TEST_REDIS_URL;
const describeWithRedis = url === undefined ? describe.skip : describe;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeWithRedis("RedisJobQueue", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it("delivers an enqueued job to a worker", async () => {
    const redisUrl = url as string;
    const producer = new RedisJobQueue({ url: redisUrl });
    const consumer = new RedisJobQueue({ url: redisUrl });
    cleanups.push(
      () => producer.close(),
      () => consumer.close(),
    );

    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      consumer.process(async (job) => {
        seen.push(job.analysisId);
        resolve();
      });
    });

    await producer.enqueue({ analysisId: `deliver-${Date.now()}` });
    await done;
    expect(seen).toHaveLength(1);
  });

  it("does not run the same job id twice", async () => {
    const redisUrl = url as string;
    const producer = new RedisJobQueue({ url: redisUrl });
    const consumer = new RedisJobQueue({ url: redisUrl, concurrency: 1 });
    cleanups.push(
      () => producer.close(),
      () => consumer.close(),
    );

    let runs = 0;
    consumer.process(async () => {
      runs += 1;
      await delay(50);
    });

    const id = `dedup-${Date.now()}`;
    await producer.enqueue({ analysisId: id });
    await producer.enqueue({ analysisId: id });
    await producer.enqueue({ analysisId: id });

    // Give the worker room to have run a duplicate had the id not guarded it.
    await delay(400);
    expect(runs).toBe(1);
  });
});

describeWithRedis("RedisEventBus", () => {
  it("carries a published event to a bridged sink", async () => {
    const redisUrl = url as string;
    const publisher = new RedisEventBus(redisUrl);
    const receiver = new RedisEventBus(redisUrl);

    const received: Array<{ id: string; event: AnalysisEvent }> = [];
    const arrived = new Promise<void>((resolve) => {
      void receiver.bridgeTo((id, event) => {
        received.push({ id, event });
        resolve();
      });
    });
    // Subscriptions settle asynchronously; publish once it is listening.
    await delay(100);

    const event: AnalysisEvent = {
      version: 1,
      type: "status",
      analysisId: "evt-1",
      status: "TESTING",
      previousStatus: "REPOSITORY_ANALYSIS_RUNNING",
      at: new Date().toISOString(),
    };
    publisher.publish("evt-1", event);

    await arrived;
    await publisher.close();
    await receiver.close();

    expect(received).toEqual([{ id: "evt-1", event }]);
  });
});
