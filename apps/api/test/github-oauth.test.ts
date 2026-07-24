/**
 * The GitHub sign-in flow, end to end over HTTP.
 *
 * GitHub itself is the only thing faked: `fetch` is stubbed, so the routes, the
 * state signing, the storage lookups and the session that comes out are the real
 * ones. What the browser is handed here is what a browser would be handed.
 */
import { verifyState } from "@proofforge/github";
import type { User } from "@proofforge/shared-types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth, setup } from "./helpers.js";

const STATE_SECRET = "test-state-secret";
const WEB = "http://localhost:3000";
const API = "http://api.test";

const OAUTH_ENV = {
  GITHUB_APP_CLIENT_ID: "Iv1.test",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_OAUTH_BASE_URL: "https://github.test",
  GITHUB_API_BASE_URL: "https://api.github.test",
  AUTH_STATE_SECRET: STATE_SECRET,
  API_BASE_URL: API,
  WEB_BASE_URL: WEB,
};

const PROFILE = {
  id: 4242,
  login: "octocat",
  name: "The Octocat",
  email: "octocat@example.com",
  avatar_url: "https://avatars.example/octocat.png",
};

/** Answer the two calls the callback makes, in the order it makes them. */
function stubGitHub(
  responses: {
    token?: unknown;
    tokenOk?: boolean;
    profile?: unknown;
    emails?: unknown;
  } = {},
): ReturnType<typeof vi.fn> {
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.includes("/login/oauth/access_token")) {
      return {
        ok: responses.tokenOk ?? true,
        status: (responses.tokenOk ?? true) ? 200 : 401,
        json: async () => responses.token ?? { access_token: "gho_token" },
      } as unknown as Response;
    }
    if (url.endsWith("/user")) {
      return {
        ok: true,
        status: 200,
        json: async () => responses.profile ?? PROFILE,
      } as unknown as Response;
    }
    if (url.endsWith("/user/emails")) {
      return {
        ok: true,
        status: 200,
        json: async () => responses.emails ?? [],
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

/** The token and friends ride in the fragment, which is not a query string. */
function fragment(location: string): URLSearchParams {
  const hash = location.indexOf("#");
  expect(hash).toBeGreaterThan(-1);
  return new URLSearchParams(location.slice(hash + 1));
}

interface StartedFlow {
  state: string;
  /** What the browser would send back, so the callback is tested as one. */
  headers: { cookie: string };
}

/** Run the first leg for real, so the callback is tested against a genuine state. */
async function startFlow(app: FastifyInstance): Promise<StartedFlow> {
  const res = await app.inject({ method: "GET", url: "/api/v1/auth/github" });
  const state = new URL(res.headers.location as string).searchParams.get("state")!;
  const cookie = (res.headers["set-cookie"] as string).split(";")[0]!;
  return { state, headers: { cookie } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auth config", () => {
  it("advertises github once credentials are present", async () => {
    const { app } = await setup(OAUTH_ENV);
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/config" });
    expect(res.json()).toEqual({ github: true, devLogin: true });
  });

  it("advertises only dev-login without them", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/config" });
    expect(res.json()).toEqual({ github: false, devLogin: true });
  });
});

describe("GET /api/v1/auth/github", () => {
  it("redirects to GitHub with a verifiable state", async () => {
    const { app } = await setup(OAUTH_ENV);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/github?redirect=/repositories/7",
    });

    expect(response.statusCode).toBe(302);
    const url = new URL(response.headers.location as string);
    expect(url.origin + url.pathname).toBe("https://github.test/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.test");
    expect(url.searchParams.get("redirect_uri")).toBe(`${API}/api/v1/auth/github/callback`);

    const state = verifyState(STATE_SECRET, url.searchParams.get("state")!);
    expect(state?.redirectTo).toBe("/repositories/7");
  });

  it("refuses to carry an off-site redirect", async () => {
    const { app } = await setup(OAUTH_ENV);
    for (const hostile of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/auth/github?redirect=${encodeURIComponent(hostile)}`,
      });
      const state = new URL(response.headers.location as string).searchParams.get("state")!;
      expect(verifyState(STATE_SECRET, state)?.redirectTo).toBe("/dashboard");
    }
  });

  it("reports itself unconfigured when the app has no OAuth credentials", async () => {
    const { app } = await setup();
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/github" });
    expect(response.statusCode).toBe(503);
  });

  it("ignores a repeated redirect parameter, which arrives as an array", async () => {
    const { app } = await setup(OAUTH_ENV);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/github?redirect=/dashboard&redirect=//evil.example",
    });

    const state = new URL(response.headers.location as string).searchParams.get("state")!;
    expect(verifyState(STATE_SECRET, state)?.redirectTo).toBe("/dashboard");
  });

  it("gives the browser a binding cookie no script can read", async () => {
    const { app } = await setup(OAUTH_ENV);
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/github" });

    const cookie = response.headers["set-cookie"] as string;
    expect(cookie).toContain("HttpOnly");
    // Lax, not Strict: the callback is a cross-site top-level navigation, and
    // Strict would withhold the cookie on the one request that needs it.
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/v1/auth");
    // This deployment is plain http, and a Secure cookie here is one the
    // browser would discard, breaking every login.
    expect(cookie).not.toContain("Secure");

    const nonce = cookie.split(";")[0]!.split("=")[1];
    const state = new URL(response.headers.location as string).searchParams.get("state")!;
    expect(verifyState(STATE_SECRET, state)?.nonce).toBe(nonce);
  });

  it("marks the cookie Secure when the API is served over TLS", async () => {
    const { app } = await setup({ ...OAUTH_ENV, API_BASE_URL: "https://api.example.com" });
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/github" });
    expect(response.headers["set-cookie"] as string).toContain("Secure");
  });
});

describe("GET /api/v1/auth/github/callback", () => {
  it("creates the user, issues a working session and returns it in the fragment", async () => {
    stubGitHub();
    const { app, deps } = await setup(OAUTH_ENV);
    const { state, headers } = await startFlow(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=the-code&state=${encodeURIComponent(state)}`,
      headers,
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location as string;
    expect(location.startsWith(`${WEB}/auth/callback#`)).toBe(true);
    // A query string would put the session token in the web server's access log.
    expect(location.slice(0, location.indexOf("#"))).not.toContain("token=");

    const params = fragment(location);
    expect(params.get("redirect")).toBe("/dashboard");

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: auth(params.get("token")!),
    });
    expect(me.statusCode).toBe(200);
    const user = me.json() as User;
    expect(user).toMatchObject({
      name: "The Octocat",
      email: "octocat@example.com",
      githubUserId: "4242",
      avatarUrl: "https://avatars.example/octocat.png",
    });
    expect(await deps.storage.getUserByGithubId("4242")).not.toBeNull();
  });

  it("signs an existing user back in instead of duplicating them", async () => {
    stubGitHub();
    const { app } = await setup(OAUTH_ENV);

    async function signIn(): Promise<string> {
      const { state, headers } = await startFlow(app);
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
        headers,
      });
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: auth(fragment(response.headers.location as string).get("token")!),
      });
      return (me.json() as User).id;
    }

    expect(await signIn()).toBe(await signIn());
  });

  it("falls back to a stable noreply address for a private profile", async () => {
    stubGitHub({ profile: { ...PROFILE, email: null, name: null }, emails: [] });
    const { app } = await setup(OAUTH_ENV);
    const { state, headers } = await startFlow(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
      headers,
    });
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: auth(fragment(response.headers.location as string).get("token")!),
    });

    expect(me.json()).toMatchObject({
      // No name on the profile either, so the login stands in.
      name: "octocat",
      email: "4242+octocat@users.noreply.github.com",
    });
  });

  it("refuses a callback the browser did not start, however valid the state", async () => {
    // The login CSRF: an attacker authorizes with their own account, captures
    // their callback URL before using it, and sends it to someone else. The
    // state signature checks out — it is genuinely ours — so the only thing
    // that can tell the victim's browser apart is the cookie it never got.
    stubGitHub();
    const { app, deps } = await setup(OAUTH_ENV);
    const { state } = await startFlow(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=attacker-code&state=${encodeURIComponent(state)}`,
    });

    expect(fragment(response.headers.location as string).get("error")).toBe("invalid_state");
    expect(await deps.storage.getUserByGithubId("4242")).toBeNull();
  });

  it("refuses a callback carrying somebody else's binding", async () => {
    stubGitHub();
    const { app } = await setup(OAUTH_ENV);
    const { state } = await startFlow(app);
    const other = await startFlow(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
      headers: other.headers,
    });

    expect(fragment(response.headers.location as string).get("error")).toBe("invalid_state");
  });

  it("clears the binding cookie once the login is over, however it ended", async () => {
    stubGitHub();
    const { app } = await setup(OAUTH_ENV);
    const { state, headers } = await startFlow(app);

    const ok = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
      headers,
    });
    expect(ok.headers["set-cookie"] as string).toContain("Max-Age=0");

    const declined = await app.inject({
      method: "GET",
      url: "/api/v1/auth/github/callback?error=access_denied",
    });
    expect(declined.headers["set-cookie"] as string).toContain("Max-Age=0");
  });

  it("adopts the account a concurrent first sign-in created instead of failing", async () => {
    // Two callbacks for the same brand new identity both find nothing, and the
    // loser hits the unique index. The account exists — reporting a failed
    // login for it would be wrong.
    stubGitHub();
    const { app, deps } = await setup(OAUTH_ENV);
    const winner = await deps.storage.createUser({
      name: "The Octocat",
      email: "octocat@example.com",
      avatarUrl: null,
      githubUserId: "4242",
    });

    const lookup = vi.spyOn(deps.storage, "getUserByGithubId").mockResolvedValueOnce(null);
    const create = vi
      .spyOn(deps.storage, "createUser")
      .mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));

    const { state, headers } = await startFlow(app);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
      headers,
    });

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: auth(fragment(response.headers.location as string).get("token")!),
    });
    expect((me.json() as User).id).toBe(winner.id);
    expect(create).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("still fails when the account cannot be created for any other reason", async () => {
    stubGitHub();
    const { app, deps } = await setup(OAUTH_ENV);
    vi.spyOn(deps.storage, "createUser").mockRejectedValue(new Error("database is down"));

    const { state, headers } = await startFlow(app);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=c&state=${encodeURIComponent(state)}`,
      headers,
    });

    expect(fragment(response.headers.location as string).get("error")).toBe("oauth_failed");
  });

  it("rejects a callback whose state was not issued here", async () => {
    stubGitHub();
    const { app, deps } = await setup(OAUTH_ENV);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/github/callback?code=c&state=forged",
    });

    expect(fragment(response.headers.location as string).get("error")).toBe("invalid_state");
    expect(await deps.storage.getUserByGithubId("4242")).toBeNull();
  });

  it("rejects a callback with no code at all", async () => {
    stubGitHub();
    const { app } = await setup(OAUTH_ENV);
    const { state, headers } = await startFlow(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?state=${encodeURIComponent(state)}`,
      headers,
    });
    expect(fragment(response.headers.location as string).get("error")).toBe("invalid_state");
  });

  it("passes a declined authorization through as such", async () => {
    const { app } = await setup(OAUTH_ENV);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/github/callback?error=access_denied",
    });
    expect(fragment(response.headers.location as string).get("error")).toBe("access_denied");
  });

  it("reports a generic failure, and no detail, when GitHub rejects the exchange", async () => {
    stubGitHub({ token: { error: "bad_verification_code" } });
    const { app } = await setup(OAUTH_ENV);
    const { state, headers } = await startFlow(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=used&state=${encodeURIComponent(state)}`,
      headers,
    });

    const location = response.headers.location as string;
    expect(fragment(location).get("error")).toBe("oauth_failed");
    expect(location).not.toContain("bad_verification_code");
    expect(location).not.toContain("client-secret");
  });

  it("is unconfigured without credentials, rather than half-working", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/github/callback?code=c",
    });
    expect(response.statusCode).toBe(503);
  });
});
