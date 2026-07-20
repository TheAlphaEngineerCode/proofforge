/**
 * Metrics are read by a machine, so the exposition format is the contract.
 *
 * A line a scraper rejects does not show up as an error anywhere — the series
 * simply never appears, which looks exactly like "this never happened".
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_BUCKETS, Metrics } from "../src/metrics.js";

describe("counters", () => {
  it("adds up repeats of the same series", () => {
    const metrics = new Metrics();

    metrics.increment("collectors_total", { collector: "coverage" });
    metrics.increment("collectors_total", { collector: "coverage" });

    expect(metrics.render()).toContain('collectors_total{collector="coverage"} 2');
  });

  it("keeps series with different labels apart", () => {
    const metrics = new Metrics();

    metrics.increment("collectors_total", { collector: "coverage", status: "ok" });
    metrics.increment("collectors_total", { collector: "coverage", status: "unavailable" });

    const out = metrics.render();
    expect(out).toContain('collector="coverage",status="ok"} 1');
    expect(out).toContain('collector="coverage",status="unavailable"} 1');
  });

  it("orders labels the same way however they were written", () => {
    // Otherwise {a,b} and {b,a} become two series for one thing.
    const metrics = new Metrics();

    metrics.increment("runs_total", { a: "1", b: "2" });
    metrics.increment("runs_total", { b: "2", a: "1" });

    expect(metrics.render()).toContain('runs_total{a="1",b="2"} 2');
  });

  it("accepts an explicit amount, for costs and token counts", () => {
    const metrics = new Metrics();

    metrics.increment("tokens_total", { kind: "input" }, 1450);

    expect(metrics.render()).toContain('tokens_total{kind="input"} 1450');
  });
});

describe("histograms", () => {
  it("counts an observation in every bucket at or above it", () => {
    const metrics = new Metrics();

    metrics.observe("duration_seconds", 0.3);

    const out = metrics.render();
    expect(out).toContain('duration_seconds_bucket{le="0.25"} 0');
    expect(out).toContain('duration_seconds_bucket{le="1"} 1');
    expect(out).toContain('duration_seconds_bucket{le="+Inf"} 1');
  });

  it("keeps a sum and a count alongside the buckets", () => {
    const metrics = new Metrics();

    metrics.observe("duration_seconds", 1);
    metrics.observe("duration_seconds", 3);

    const out = metrics.render();
    expect(out).toContain("duration_seconds_sum 4");
    expect(out).toContain("duration_seconds_count 2");
  });

  it("still counts an observation past the largest bucket", () => {
    const metrics = new Metrics();

    metrics.observe("duration_seconds", 10_000);

    const out = metrics.render();
    const largest = DEFAULT_BUCKETS[DEFAULT_BUCKETS.length - 1];
    expect(out).toContain(`duration_seconds_bucket{le="${largest}"} 0`);
    expect(out).toContain('duration_seconds_bucket{le="+Inf"} 1');
  });

  it("times work that succeeds", async () => {
    const metrics = new Metrics();

    await metrics.time("step_seconds", { step: "collect" }, async () => "done");

    expect(metrics.render()).toContain('step_seconds_count{step="collect"} 1');
  });

  it("times work that throws, and lets the error through", async () => {
    // A step that failed still consumed time; not recording it would hide the
    // slowest paths precisely when they matter.
    const metrics = new Metrics();

    await expect(
      metrics.time("step_seconds", { step: "collect" }, async () => {
        throw new Error("toolchain missing");
      }),
    ).rejects.toThrow("toolchain missing");

    expect(metrics.render()).toContain('step_seconds_count{step="collect"} 1');
  });
});

describe("exposition", () => {
  it("declares the type of each metric", () => {
    const metrics = new Metrics();
    metrics.increment("runs_total");
    metrics.observe("duration_seconds", 1);

    const out = metrics.render();
    expect(out).toContain("# TYPE runs_total counter");
    expect(out).toContain("# TYPE duration_seconds histogram");
  });

  it("includes help text when it was described", () => {
    const metrics = new Metrics();
    metrics.describe("runs_total", "Analyses started.");
    metrics.increment("runs_total");

    expect(metrics.render()).toContain("# HELP runs_total Analyses started.");
  });

  it("escapes a label value that would otherwise break the line", () => {
    // Label values come from manifests, so they are not ours to trust.
    const metrics = new Metrics();

    metrics.increment("runs_total", { repo: 'ac"me\nevil' });

    expect(metrics.render()).toContain('runs_total{repo="ac\\"me\\nevil"} 1');
  });

  it("renders nothing at all when nothing has been recorded", () => {
    expect(new Metrics().render()).toBe("");
  });
});
