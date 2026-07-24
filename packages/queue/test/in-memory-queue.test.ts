import { describe, expect, it } from "vitest";
import type { AnalysisJob } from "@proofforge/shared-types";
import { InMemoryJobQueue } from "../src/in-memory-queue.js";

const job = (analysisId: string): AnalysisJob => ({ analysisId });

describe("InMemoryJobQueue", () => {
  it("runs the registered handler for an enqueued job", async () => {
    const seen: string[] = [];
    const queue = new InMemoryJobQueue();
    queue.process(async (j) => {
      seen.push(j.analysisId);
    });

    await queue.enqueue(job("a1"));
    await queue.settle("a1");

    expect(seen).toEqual(["a1"]);
  });

  it("refuses to enqueue before a handler is registered", () => {
    const queue = new InMemoryJobQueue();
    expect(() => queue.enqueue(job("a1"))).toThrow(/handler/);
  });

  it("refuses a second handler, as the Redis backend does", () => {
    const queue = new InMemoryJobQueue();
    queue.process(async () => {});
    expect(() => queue.process(async () => {})).toThrow(/twice/);
  });

  it("does not start the same analysis twice while it is in flight", async () => {
    let running = 0;
    let maxConcurrent = 0;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queue = new InMemoryJobQueue();
    queue.process(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await gate;
      running -= 1;
    });

    // Three deliveries of the same id while the first is still blocked.
    await queue.enqueue(job("dup"));
    await queue.enqueue(job("dup"));
    await queue.enqueue(job("dup"));
    release();
    await queue.settle("dup");

    expect(maxConcurrent).toBe(1);
  });

  it("re-runs a job that throws, up to the attempt limit", async () => {
    let calls = 0;
    const queue = new InMemoryJobQueue({ attempts: 3 });
    queue.process(async () => {
      calls += 1;
      throw new Error("boom");
    });

    await queue.enqueue(job("retry"));
    await queue.settle("retry");

    expect(calls).toBe(3);
  });

  it("stops retrying once a job succeeds", async () => {
    let calls = 0;
    const queue = new InMemoryJobQueue({ attempts: 5 });
    queue.process(async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
    });

    await queue.enqueue(job("eventually"));
    await queue.settle("eventually");

    expect(calls).toBe(2);
  });

  it("swallows a permanently failing job rather than rejecting", async () => {
    const queue = new InMemoryJobQueue({ attempts: 2 });
    queue.process(async () => {
      throw new Error("permanent");
    });

    // The enqueue promise must resolve, not reject: the run is fire-and-forget
    // and a rejection would have nowhere to be caught.
    await expect(queue.enqueue(job("dead"))).resolves.toBeUndefined();
    await queue.settle("dead");
  });

  it("waits on nothing for an unknown id", async () => {
    const queue = new InMemoryJobQueue();
    queue.process(async () => {});
    await expect(queue.settle("never-enqueued")).resolves.toBeUndefined();
  });

  it("lets in-flight work finish on close", async () => {
    let finished = false;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new InMemoryJobQueue();
    queue.process(async () => {
      await gate;
      finished = true;
    });

    await queue.enqueue(job("slow"));
    release();
    await queue.close();

    expect(finished).toBe(true);
  });
});
