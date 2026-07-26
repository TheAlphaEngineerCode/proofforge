import { verifyManifest } from "@proofforge/evidence-spec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers.js";
import { auth, login, setup } from "./helpers.js";

let ctx: TestApp;

beforeEach(async () => {
  ctx = await setup();
});
afterEach(async () => {
  await ctx.app.close();
});

describe("health & auth", () => {
  it("serves health and readiness without auth", async () => {
    expect((await ctx.app.inject({ url: "/health" })).json()).toEqual({ status: "ok" });
    // "simulated" is the truth about a test instance, and saying it is the point:
    // an instance with no pipeline serves the same shapes as one with it.
    expect((await ctx.app.inject({ url: "/ready" })).json()).toEqual({
      status: "ready",
      evidence: "simulated",
    });
  });

  it("reports a configured pipeline once the engine is wired", async () => {
    const wired = await setup({ EVIDENCE_ENGINE_DIR: "/opt/proofforge/evidence-engine" });

    expect((await wired.app.inject({ url: "/ready" })).json()).toEqual({
      status: "ready",
      evidence: "configured",
    });

    await wired.app.close();
  });

  it("rejects /me without a token", async () => {
    const res = await ctx.app.inject({ url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("issues a session via dev-login and resolves /me", async () => {
    const { token, userId } = await login(ctx.app);
    const res = await ctx.app.inject({ url: "/api/v1/me", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }).id).toBe(userId);
  });
});

describe("organizations & repositories", () => {
  it("creates an org and a repository under it", async () => {
    const { token } = await login(ctx.app);
    const orgRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: auth(token),
      payload: { name: "Acme", slug: "acme" },
    });
    expect(orgRes.statusCode).toBe(201);
    const org = orgRes.json() as { id: string };

    const repoRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/repositories",
      headers: auth(token),
      payload: { organizationId: org.id, owner: "acme", name: "api" },
    });
    expect(repoRes.statusCode).toBe(201);
    expect((repoRes.json() as { defaultBranch: string }).defaultBranch).toBe("main");
  });

  it("validates the org slug", async () => {
    const { token } = await login(ctx.app);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: auth(token),
      payload: { name: "Bad", slug: "Not Valid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("isolates tenants: another user cannot see the org's repositories", async () => {
    const owner = await login(ctx.app);
    const orgRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: auth(owner.token),
      payload: { name: "Acme", slug: "acme" },
    });
    const org = orgRes.json() as { id: string };

    const intruder = await login(ctx.app);
    const res = await ctx.app.inject({
      url: `/api/v1/repositories?organizationId=${org.id}`,
      headers: auth(intruder.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("analysis pipeline", () => {
  async function connectedRepo(token: string): Promise<string> {
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
    return repo.id;
  }

  it("runs an analysis to a bundle whose manifest verifies", async () => {
    const { token } = await login(ctx.app);
    const repoId = await connectedRepo(token);

    const started = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/repositories/${repoId}/analyze`,
      headers: auth(token),
      payload: { commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912" },
    });
    expect(started.statusCode).toBe(202);
    const analysis = started.json() as { id: string; status: string };
    expect(analysis.status).toBe("CREATED");

    await ctx.deps.queue.settle(analysis.id);

    const finished = (
      await ctx.app.inject({ url: `/api/v1/analyses/${analysis.id}`, headers: auth(token) })
    ).json() as { status: string; riskScore: number; evidenceBundleId: string };
    expect(finished.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
    expect(finished.riskScore).toBe(18);
    expect(finished.evidenceBundleId).toBeTruthy();

    const manifest = (
      await ctx.app.inject({
        url: `/api/v1/evidence-bundles/${finished.evidenceBundleId}/manifest`,
        headers: auth(token),
      })
    ).json();
    const result = verifyManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.hash?.valid).toBe(true);
  });

  // These two values become the ref and the remote of a `git fetch`, so the
  // interesting case is not a typo — it is an argument dressed as a commit.
  it.each([
    ["an option rather than a ref", "--upload-pack=touch /tmp/pwned"],
    ["a branch name", "refs/heads/main"],
    ["a sha with a non-hex character", "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f8091z"],
    ["too short to identify a commit", "9c82fd"],
  ])("refuses a commit that is %s", async (_case, commitSha) => {
    const { token } = await login(ctx.app);
    const repoId = await connectedRepo(token);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/repositories/${repoId}/analyze`,
      headers: auth(token),
      payload: { commitSha },
    });

    expect(res.statusCode).toBe(400);
    expect(await ctx.deps.storage.listAnalyses(repoId)).toHaveLength(0);
  });

  it("refuses a repository whose owner is not a GitHub account name", async () => {
    const { token } = await login(ctx.app);
    const org = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/organizations",
        headers: auth(token),
        payload: { name: "Acme", slug: "acme" },
      })
    ).json() as { id: string };

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/repositories",
      headers: auth(token),
      payload: { organizationId: org.id, owner: "acme@evil.example/x", name: "api" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("asking for the same analysis twice", () => {
  it("hands back the analysis that already covers the commit", async () => {
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

    const payload = { commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912" };
    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/repositories/${repo.id}/analyze`,
      headers: auth(token),
      payload,
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/repositories/${repo.id}/analyze`,
      headers: auth(token),
      payload,
    });

    expect(first.statusCode).toBe(202);
    // Answered, not refused and not run a second time: evidence is bound to a
    // commit, so a second bundle for one commit is the thing to avoid.
    expect(second.statusCode).toBe(200);
    expect((second.json() as { id: string }).id).toBe((first.json() as { id: string }).id);
    expect(await ctx.deps.storage.listAnalyses(repo.id)).toHaveLength(1);
  });
});
