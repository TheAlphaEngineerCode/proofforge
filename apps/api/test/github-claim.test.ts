/**
 * Connecting an installation to an organization.
 *
 * The whole value of this route is what it refuses. Installation ids are small
 * consecutive integers, so anything weaker than "prove you installed it" — first
 * come, or merely being signed in — hands a tenant's deliveries to whoever
 * guesses a number first.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { auth, login, setup, type TestApp } from "./helpers.js";

const INSTALLATION_ID = 987;

let ctx: TestApp;

beforeEach(async () => {
  ctx = await setup();
});
afterEach(async () => {
  await ctx.app.close();
});

/** A signed-in user carrying a GitHub identity, as OAuth login produces. */
async function githubUser(githubUserId: string): Promise<{ token: string; orgId: string }> {
  const user = await ctx.deps.storage.createUser({
    name: "Ada",
    email: `ada+${githubUserId}@example.com`,
    githubUserId,
  });
  const session = await ctx.deps.storage.createSession(user.id);
  const org = await ctx.deps.storage.createOrganization({
    name: "Acme",
    slug: `acme-${githubUserId}`,
    ownerId: user.id,
  });
  return { token: session.token, orgId: org.id };
}

async function announceInstallation(installedBy: string | null): Promise<void> {
  await ctx.deps.storage.upsertInstallation({
    githubInstallationId: INSTALLATION_ID,
    accountLogin: "acme",
    installedBy,
  });
}

function claim(token: string, organizationId: string, installationId: number = INSTALLATION_ID) {
  return ctx.app.inject({
    method: "POST",
    url: `/api/v1/github/installations/${installationId}/claim`,
    headers: auth(token),
    payload: { organizationId },
  });
}

describe("claiming a github installation", () => {
  it("connects it for the account that installed the app", async () => {
    const { token, orgId } = await githubUser("4242");
    await announceInstallation("4242");

    const res = await claim(token, orgId);

    expect(res.statusCode).toBe(200);
    expect((await ctx.deps.storage.getInstallation(INSTALLATION_ID))?.organizationId).toBe(orgId);
  });

  it("is idempotent for the organization that already holds it", async () => {
    const { token, orgId } = await githubUser("4242");
    await announceInstallation("4242");

    await claim(token, orgId);
    const again = await claim(token, orgId);

    expect(again.statusCode).toBe(200);
  });

  it("refuses someone who did not install it", async () => {
    // Mallory is perfectly legitimate — signed in, owns her organization. What
    // she does not have is the GitHub identity GitHub reported at install time.
    const { token, orgId } = await githubUser("9999");
    await announceInstallation("4242");

    const res = await claim(token, orgId);

    expect(res.statusCode).toBe(403);
    expect((await ctx.deps.storage.getInstallation(INSTALLATION_ID))?.organizationId).toBeNull();
  });

  it("says an installation with no recorded installer has to be reinstalled", async () => {
    // The state every installation that predates this code is in. The answer has
    // to be actionable: "not you" would send someone looking for the wrong fix.
    const { token, orgId } = await githubUser("4242");
    await announceInstallation(null);

    const res = await claim(token, orgId);

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toContain("reinstall");
  });

  it("refuses a dev-login session, which carries no GitHub identity at all", async () => {
    const { token } = await login(ctx.app);
    const me = (await ctx.app.inject({ url: "/api/v1/me", headers: auth(token) })).json() as {
      id: string;
    };
    const org = await ctx.deps.storage.createOrganization({
      name: "Acme",
      slug: "acme-dev",
      ownerId: me.id,
    });
    // An installation nobody can be shown to have installed is not claimable
    // either — a null installer must never match a null identity.
    await announceInstallation(null);

    const res = await claim(token, org.id);

    expect(res.statusCode).toBe(403);
  });

  it("refuses to move an installation another organization already holds", async () => {
    const first = await githubUser("4242");
    await announceInstallation("4242");
    await claim(first.token, first.orgId);

    // The same person, a second organization: still not a transfer.
    const second = await ctx.deps.storage.createOrganization({
      name: "Other",
      slug: "other",
      ownerId: (await ctx.deps.storage.getUserByGithubId("4242"))!.id,
    });
    const res = await claim(first.token, second.id);

    expect(res.statusCode).toBe(409);
    expect((await ctx.deps.storage.getInstallation(INSTALLATION_ID))?.organizationId).toBe(
      first.orgId,
    );
  });

  it("refuses to claim into an organization the caller does not own", async () => {
    const owner = await githubUser("4242");
    const outsider = await githubUser("4242-b");
    await announceInstallation("4242-b");

    const res = await claim(outsider.token, owner.orgId);

    expect(res.statusCode).toBe(403);
  });

  it("reports an installation it has never heard of", async () => {
    const { token, orgId } = await githubUser("4242");

    const res = await claim(token, orgId, 424242);

    expect(res.statusCode).toBe(404);
  });

  it("rejects an installation id that is not a positive integer", async () => {
    const { token, orgId } = await githubUser("4242");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/github/installations/not-a-number/claim",
      headers: auth(token),
      payload: { organizationId: orgId },
    });

    expect(res.statusCode).toBe(400);
  });

  it("requires a session", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/github/installations/${INSTALLATION_ID}/claim`,
      payload: { organizationId: "00000000-0000-0000-0000-000000000000" },
    });

    expect(res.statusCode).toBe(401);
  });
});
