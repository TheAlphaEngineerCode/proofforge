/**
 * Metrics are only useful if they are actually recorded by a real run.
 *
 * Unit tests on the Metrics class prove the counters count; these prove the
 * wiring, which is the part that silently goes missing — an unwired metric
 * renders as an empty page and reads exactly like "nothing has happened yet".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { auth, login, setup, type TestApp } from "./helpers.js";

describe("the metrics endpoint", () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("serves the format a scraper expects", async () => {
    const res = await ctx.app.inject({ url: "/metrics" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("counts an analysis once it reaches a terminal state", async () => {
    const { token } = await login(ctx.app);
    const org = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/organizations",
        headers: auth(token),
        payload: { name: "Acme", slug: "acme" },
      })
    ).json() as { id: string };
    const repo = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/repositories",
        headers: auth(token),
        payload: { organizationId: org.id, owner: "acme", name: "api" },
      })
    ).json() as { id: string };

    const started = (
      await ctx.app.inject({
        method: "POST",
        url: `/api/v1/repositories/${repo.id}/analyze`,
        headers: auth(token),
        payload: { commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912" },
      })
    ).json() as { id: string };
    await ctx.deps.queue.settle(started.id);

    const body = (await ctx.app.inject({ url: "/metrics" })).body;

    expect(body).toContain('proofforge_analyses_total{status="WAITING_FOR_HUMAN_APPROVAL"} 1');
    expect(body).toContain("proofforge_analysis_duration_seconds_count");
  });

  it("says nothing before anything has been measured", async () => {
    // An empty body, not a page of zeroes: a zero here would be indistinguishable
    // from a real measurement of zero, which is the distinction this project exists to keep.
    expect((await ctx.app.inject({ url: "/metrics" })).body).toBe("");
  });
});

/**
 * Who may read it. The labels name the repositories a deployment analyses, so
 * the endpoint is open only where the deployment says it is safe to be open.
 */
describe("the metrics endpoint — access", () => {
  it("turns a scrape away when it presents the wrong token, or none", async () => {
    const ctx = await setup({ METRICS_TOKEN: "s3cret" });

    expect((await ctx.app.inject({ url: "/metrics" })).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ url: "/metrics", headers: auth("wrong") })).statusCode,
    ).toBe(401);

    await ctx.app.close();
  });

  it("serves the scrape that presents the token", async () => {
    const ctx = await setup({ METRICS_TOKEN: "s3cret" });

    const res = await ctx.app.inject({ url: "/metrics", headers: auth("s3cret") });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    await ctx.app.close();
  });

  it("is not served at all in production when no token is configured", async () => {
    // Absent rather than open: an unconfigured production deployment should not
    // publish its repository names to whoever finds the port.
    const ctx = await setup({ NODE_ENV: "production" });

    expect((await ctx.app.inject({ url: "/metrics" })).statusCode).toBe(404);

    await ctx.app.close();
  });
});
