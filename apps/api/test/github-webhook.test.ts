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

/**
 * A tenant as the product actually assembles one: an organization, an
 * installation it has claimed, and a repository registered under it. Deliveries
 * are routed by the installation, so a repository without one is unreachable —
 * which is the point of the fixture rather than an accident of it.
 */
async function connectRepository(
  owner: string,
  name: string,
  installationId = 987,
): Promise<{ repositoryId: string; organizationId: string }> {
  const user = await ctx.deps.storage.createUser({
    name: "u",
    email: `u+${owner}-${name}@example.com`,
  });
  const org = await ctx.deps.storage.createOrganization({
    name: owner,
    slug: `${owner}-${name}`,
    ownerId: user.id,
  });
  await ctx.deps.storage.upsertInstallation({
    githubInstallationId: installationId,
    accountLogin: owner,
  });
  await ctx.deps.storage.claimInstallation(installationId, org.id);
  const repo = await ctx.deps.storage.createRepository({
    organizationId: org.id,
    owner,
    name,
    defaultBranch: "main",
    language: null,
    private: false,
  });
  return { repositoryId: repo.id, organizationId: org.id };
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
    const { repositoryId } = await connectRepository("acme", "api");

    const first = await ctx.app.inject(delivery("pull_request", pullRequestPayload()));
    const second = await ctx.app.inject(delivery("pull_request", pullRequestPayload()));

    const firstBody = first.json() as { status: string; analysisId: string };
    const secondBody = second.json() as { status: string; analysisId: string };

    expect(firstBody.status).toBe("analysis_started");
    expect(secondBody.status).toBe("already_analyzed");
    expect(secondBody.analysisId).toBe(firstBody.analysisId);

    expect(await ctx.deps.storage.listAnalyses(repositoryId)).toHaveLength(1);
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
    // The installation is claimed and delivering; it is this repository under it
    // that nobody registered. Asserting the reason keeps the test honest — an
    // earlier check bailing out first would otherwise look like a pass.
    await connectRepository("acme", "api");

    const res = await ctx.app.inject(
      delivery("pull_request", pullRequestPayload("acme", "unregistered")),
    );

    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; reason: string };
    expect(body.status).toBe("ignored");
    expect(body.reason).toBe("repository is not connected to ProofForge");
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
        sender: { id: 4242 },
      }),
    );
    expect(created.statusCode).toBe(202);
    expect(await ctx.deps.storage.getInstallation(555)).toMatchObject({
      githubInstallationId: 555,
      accountLogin: "acme",
      // Nobody has claimed it yet, and the installer is remembered so somebody can.
      organizationId: null,
      installedBy: "4242",
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

/**
 * The routing rule that decides whose evidence a delivery becomes.
 *
 * Registering a repository is not a claim on it. Anyone signed in can type
 * `owner/name` into the API, so if a delivery were matched on that pair alone,
 * the first person to type a victim's repository would receive their analyses —
 * and read the evidence bundle attached to each one.
 */
describe("github webhook — tenant isolation", () => {
  it("does not route a delivery to a squatter who merely registered the name", async () => {
    // The real owner, connected properly.
    const victim = await connectRepository("acme", "api", 987);

    // The squatter: their own organization, their own installation, and a
    // repository row naming somebody else's repository.
    const attackerUser = await ctx.deps.storage.createUser({
      name: "mallory",
      email: "mallory@example.com",
    });
    const attackerOrg = await ctx.deps.storage.createOrganization({
      name: "Mallory",
      slug: "mallory",
      ownerId: attackerUser.id,
    });
    await ctx.deps.storage.upsertInstallation({
      githubInstallationId: 1000,
      accountLogin: "mallory",
    });
    await ctx.deps.storage.claimInstallation(1000, attackerOrg.id);
    const squatted = await ctx.deps.storage.createRepository({
      organizationId: attackerOrg.id,
      owner: "acme",
      name: "api",
      defaultBranch: "main",
      language: null,
      private: false,
    });

    const res = await ctx.app.inject(delivery("pull_request", pullRequestPayload()));

    expect(res.statusCode).toBe(202);
    expect((res.json() as { status: string }).status).toBe("analysis_started");
    // The analysis belongs to the account the installation was delivered for,
    // and the squatter's row never sees a thing.
    expect(await ctx.deps.storage.listAnalyses(victim.repositoryId)).toHaveLength(1);
    expect(await ctx.deps.storage.listAnalyses(squatted.id)).toHaveLength(0);
  });

  it("ignores a delivery from an installation nobody has claimed", async () => {
    // Everything is in place except the connection between the installation and
    // a tenant — so there is no organization the result could belong to.
    const user = await ctx.deps.storage.createUser({ name: "u", email: "u@example.com" });
    const org = await ctx.deps.storage.createOrganization({
      name: "Acme",
      slug: "acme",
      ownerId: user.id,
    });
    await ctx.deps.storage.createRepository({
      organizationId: org.id,
      owner: "acme",
      name: "api",
      defaultBranch: "main",
      language: null,
      private: false,
    });
    await ctx.deps.storage.upsertInstallation({
      githubInstallationId: 987,
      accountLogin: "acme",
    });

    const res = await ctx.app.inject(delivery("pull_request", pullRequestPayload()));

    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; reason: string };
    expect(body.status).toBe("ignored");
    expect(body.reason).toContain("not connected to an organization");
  });
});
