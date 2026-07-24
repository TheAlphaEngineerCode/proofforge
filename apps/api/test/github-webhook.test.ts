import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers.js";
import { setup } from "./helpers.js";

const SECRET = "webhook-test-secret";
const WEBHOOK_URL = "/api/v1/github/webhook";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function delivery(event: string, payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  return {
    method: "POST" as const,
    url: WEBHOOK_URL,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": "test-delivery-1",
      "x-hub-signature-256": sign(body, secret),
    },
    payload: body,
  };
}

function pullRequestPayload(owner = "acme", repo = "api") {
  return {
    action: "opened",
    number: 42,
    pull_request: {
      number: 42,
      draft: false,
      title: "Add OAuth",
      head: { sha: "a".repeat(40), ref: "feature/oauth" },
      base: { sha: "b".repeat(40), ref: "main" },
    },
    repository: { name: repo, owner: { login: owner }, default_branch: "main" },
    installation: { id: 987 },
  };
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await setup({ GITHUB_WEBHOOK_SECRET: SECRET });
});
afterEach(async () => {
  await ctx.app.close();
});

async function connectRepository(owner: string, name: string): Promise<string> {
  const user = await ctx.deps.storage.createUser({ name: "u", email: "u@example.com" });
  const org = await ctx.deps.storage.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerId: user.id,
  });
  const repo = await ctx.deps.storage.createRepository({
    organizationId: org.id,
    owner,
    name,
    defaultBranch: "main",
    language: null,
    private: false,
  });
  return repo.id;
}

describe("github webhook — authentication", () => {
  it("rejects a delivery with an invalid signature", async () => {
    const res = await ctx.app.inject(
      delivery("pull_request", pullRequestPayload(), "wrong-secret"),
    );
    expect(res.statusCode).toBe(401);
  });

  it("rejects a delivery with no signature at all", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: { "content-type": "application/json", "x-github-event": "pull_request" },
      payload: JSON.stringify(pullRequestPayload()),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a body tampered with after signing", async () => {
    const request = delivery("pull_request", pullRequestPayload());
    const res = await ctx.app.inject({
      ...request,
      payload: JSON.stringify(pullRequestPayload("attacker", "evil")),
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when no webhook secret is configured", async () => {
    const unconfigured = await setup();
    const res = await unconfigured.app.inject(delivery("pull_request", pullRequestPayload()));
    expect(res.statusCode).toBe(503);
    await unconfigured.app.close();
  });
});

describe("github webhook — routing", () => {
  it("starts an analysis for a connected repository", async () => {
    await connectRepository("acme", "api");

    const res = await ctx.app.inject(delivery("pull_request", pullRequestPayload()));
    expect(res.statusCode).toBe(202);

    const body = res.json() as { status: string; analysisId: string };
    expect(body.status).toBe("analysis_started");

    await ctx.deps.queue.settle(body.analysisId);
    const analysis = await ctx.deps.storage.getAnalysis(body.analysisId);
    expect(analysis?.commitSha).toBe("a".repeat(40));
    expect(analysis?.evidenceBundleId).toBeTruthy();
  });

  it("is idempotent: a redelivered webhook reuses the same analysis", async () => {
    await connectRepository("acme", "api");

    const first = await ctx.app.inject(delivery("pull_request", pullRequestPayload()));
    const second = await ctx.app.inject(delivery("pull_request", pullRequestPayload()));

    const firstBody = first.json() as { status: string; analysisId: string };
    const secondBody = second.json() as { status: string; analysisId: string };

    expect(firstBody.status).toBe("analysis_started");
    expect(secondBody.status).toBe("already_analyzed");
    expect(secondBody.analysisId).toBe(firstBody.analysisId);

    const repoId = (await ctx.deps.storage.findRepositoryByFullName("acme", "api"))!.id;
    expect(await ctx.deps.storage.listAnalyses(repoId)).toHaveLength(1);
  });

  it("rejects a delivery whose body is not raw JSON", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: { "content-type": "text/plain", "x-github-event": "pull_request" },
      payload: "not json",
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("ignores repositories that are not connected", async () => {
    const res = await ctx.app.inject(
      delivery("pull_request", pullRequestPayload("someone", "else")),
    );
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status: string }).status).toBe("ignored");
  });

  it("ignores non-analyzable pull request actions", async () => {
    await connectRepository("acme", "api");
    const payload = { ...pullRequestPayload(), action: "labeled" };

    const res = await ctx.app.inject(delivery("pull_request", payload));
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; reason: string };
    expect(body.status).toBe("ignored");
    expect(body.reason).toContain("labeled");
  });

  it("records an installation and removes it when deleted", async () => {
    const created = await ctx.app.inject(
      delivery("installation", {
        action: "created",
        installation: { id: 555, account: { login: "acme" } },
      }),
    );
    expect(created.statusCode).toBe(202);
    expect(await ctx.deps.storage.getInstallation(555)).toMatchObject({
      githubInstallationId: 555,
      accountLogin: "acme",
    });

    await ctx.app.inject(
      delivery("installation", { action: "deleted", installation: { id: 555 } }),
    );
    expect(await ctx.deps.storage.getInstallation(555)).toBeNull();
  });

  it("acknowledges unsupported events without retrying", async () => {
    const res = await ctx.app.inject(delivery("star", { action: "created" }));
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status: string }).status).toBe("ignored");
  });
});
