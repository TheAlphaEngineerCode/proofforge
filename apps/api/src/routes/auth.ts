/**
 * Sessions, and the two ways to obtain one.
 *
 * `dev-login` mints a session for anybody who asks, and exists only so the
 * dashboard can be used locally without a GitHub App; it is forced off in
 * production. GitHub OAuth is the real door.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  authorizeUrl,
  bindingMatches,
  createState,
  exchangeCodeForToken,
  fetchIdentity,
  verifyState,
  STATE_TTL_MS,
  type GitHubIdentity,
} from "@proofforge/github";
import type { User } from "@proofforge/shared-types";
import { z } from "zod";
import type { Config } from "../config.js";
import type { AppDeps } from "../deps.js";
import { parse } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

const DevLoginInput = z.object({
  name: z.string().min(1).default("Dev User"),
  email: z.string().email().default("dev@proofforge.local"),
});

const CALLBACK_PATH = "/api/v1/auth/github/callback";
const DEFAULT_REDIRECT = "/dashboard";

/**
 * Ties a callback to the browser that began the login.
 *
 * `SameSite=Lax` rather than `Strict`: the callback *is* a cross-site top-level
 * navigation — GitHub sends the browser here — and Strict would withhold the
 * cookie on exactly the request that needs it. `HttpOnly` because no script has
 * any reason to read it, and a `Path` narrow enough that it rides on nothing but
 * the auth routes.
 */
const BINDING_COOKIE = "proofforge_oauth";
const BINDING_PATH = "/api/v1/auth";

/**
 * Query values arrive as whatever the client sent: a repeated parameter is an
 * array, not a string, so nothing here may be typed as one before it is checked.
 */
type Query = Record<string, unknown>;

function queryString(query: Query, name: string): string | undefined {
  const value = query[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function githubOauthEnabled(config: Config): boolean {
  return Boolean(config.githubClientId && config.githubClientSecret);
}

/**
 * Confine post-login navigation to this dashboard.
 *
 * Anything a caller supplies has to survive being pasted into a phishing link:
 * a login URL that can be made to end up on another origin is an open redirect,
 * and it borrows this domain's credibility to do it. A leading `//` or `/\` is
 * absolute to a browser despite looking relative, which is the form that slips
 * past a naive `startsWith("/")` check.
 */
export function safeRedirectPath(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return DEFAULT_REDIRECT;
  if (!raw.startsWith("/")) return DEFAULT_REDIRECT;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_REDIRECT;
  return raw;
}

/**
 * Read one cookie by name, without pulling in a parser for the one we set.
 * Values here are base64url, so nothing needs decoding or unquoting.
 */
function readBindingCookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === BINDING_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function bindingCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${BINDING_COOKIE}=${value}`,
    `Max-Age=${maxAgeSeconds}`,
    `Path=${BINDING_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    // Only over TLS, and only when this API is actually served over it —
    // a Secure cookie on a plain-http localhost is one the browser drops.
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Hand the session to the browser in the URL *fragment*, never the query.
 *
 * A fragment is not sent to the server, so the token stays out of the web
 * server's access log, out of any proxy in between, and out of the `Referer`
 * header of whatever the page loads next. The SSE route has to redact a token
 * from its query string for exactly the reason this avoids one.
 */
function sessionRedirect(webOrigin: string, params: Record<string, string>): string {
  const fragment = new URLSearchParams(params).toString();
  return `${webOrigin}/auth/callback#${fragment}`;
}

/** True for an origin whose cookies a browser will only send back over TLS. */
function isSecure(baseUrl: string): boolean {
  return baseUrl.startsWith("https://");
}

/**
 * The account behind a GitHub identity, creating it on first sign-in.
 *
 * Matched on the numeric id, which survives a rename; the login does not. The
 * lookup and the insert are two statements, so two callbacks racing on a brand
 * new identity can both find nothing — and the one that loses the unique index
 * would otherwise report a failed login for an account that now exists. Losing
 * that race is a reason to look again, not to give up.
 */
async function resolveUser(deps: AppDeps, identity: GitHubIdentity): Promise<User> {
  const existing = await deps.storage.getUserByGithubId(identity.id);
  if (existing) return existing;

  try {
    return await deps.storage.createUser({
      name: identity.name ?? identity.login,
      // A user record requires an address and a private profile exposes none.
      // GitHub's own noreply form is stable, and unique because the id is —
      // which is what the storage layer's uniqueness constraint needs.
      email: identity.email ?? `${identity.id}+${identity.login}@users.noreply.github.com`,
      avatarUrl: identity.avatarUrl,
      githubUserId: identity.id,
    });
  } catch (error) {
    const winner = await deps.storage.getUserByGithubId(identity.id);
    if (winner) return winner;
    throw error;
  }
}

export function authRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config } = deps;

  app.get("/api/v1/me", async (request) => {
    return requireUser(request);
  });

  /** Lets the dashboard render the sign-in options this deployment actually has. */
  app.get("/api/v1/auth/config", async () => {
    return { github: githubOauthEnabled(config), devLogin: config.devLogin };
  });

  if (config.devLogin) {
    app.post("/api/v1/auth/dev-login", async (request, reply) => {
      const input = parse(DevLoginInput, request.body ?? {});
      const user = await deps.storage.createUser({
        name: input.name,
        email: `${Date.now()}.${input.email}`,
        avatarUrl: null,
        githubUserId: null,
      });
      const session = await deps.storage.createSession(user.id);
      void reply.status(201);
      return { token: session.token, expiresAt: session.expiresAt, user };
    });
  }

  app.get("/api/v1/auth/github", async (request, reply) => {
    if (!githubOauthEnabled(config)) {
      void reply.status(503);
      return { error: "github oauth is not configured" };
    }

    const redirect = queryString(request.query as Query, "redirect");
    const state = createState(config.authStateSecret, safeRedirectPath(redirect));

    // The browser keeps the nonce; the callback has to present it back.
    void reply.header(
      "set-cookie",
      bindingCookie(state.nonce, Math.floor(STATE_TTL_MS / 1000), isSecure(config.apiBaseUrl)),
    );

    return reply.redirect(
      authorizeUrl({
        clientId: config.githubClientId,
        redirectUri: `${config.apiBaseUrl}${CALLBACK_PATH}`,
        state: state.value,
        oauthBaseUrl: config.githubOauthBaseUrl,
      }),
      302,
    );
  });

  app.get(CALLBACK_PATH, async (request, reply) => {
    if (!githubOauthEnabled(config)) {
      void reply.status(503);
      return { error: "github oauth is not configured" };
    }

    const query = request.query as Query;
    // However this ends, the login it belongs to is over.
    const done = (params: Record<string, string>): FastifyReply => {
      void reply.header("set-cookie", bindingCookie("", 0, isSecure(config.apiBaseUrl)));
      return reply.redirect(sessionRedirect(config.webOrigin, params), 302);
    };

    // The user declined on GitHub's consent screen. Not an error to log about.
    if (queryString(query, "error")) {
      return done({ error: "access_denied" });
    }

    const presented = queryString(query, "state");
    const code = queryString(query, "code");
    const state = presented ? verifyState(config.authStateSecret, presented) : null;
    if (!state || !code) {
      request.log.warn("[auth] rejected a github callback with a missing or invalid state");
      return done({ error: "invalid_state" });
    }

    // A signature says this service issued the state; the cookie says this
    // browser is the one it was issued to. Without the second check, a callback
    // URL captured from the attacker's own login logs the victim into the
    // attacker's account.
    if (!bindingMatches(state, readBindingCookie(request))) {
      request.log.warn("[auth] rejected a github callback that no browser here had started");
      return done({ error: "invalid_state" });
    }

    try {
      const accessToken = await exchangeCodeForToken({
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        code,
        redirectUri: `${config.apiBaseUrl}${CALLBACK_PATH}`,
        oauthBaseUrl: config.githubOauthBaseUrl,
      });

      const identity = await fetchIdentity(accessToken, { apiBaseUrl: config.githubApiBaseUrl });

      const user = await resolveUser(deps, identity);
      const session = await deps.storage.createSession(user.id);

      return done({
        token: session.token,
        expiresAt: session.expiresAt,
        redirect: state.redirectTo,
      });
    } catch (error) {
      // The browser gets a code, not a reason: the detail here can name GitHub's
      // rejection of a secret, and a redirect URL is the least private place in
      // the system. The reason goes to the log, where it belongs.
      request.log.error({ err: error }, "[auth] github oauth callback failed");
      return done({ error: "oauth_failed" });
    }
  });
}
