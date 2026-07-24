/**
 * GitHub OAuth — the user-facing half of the App.
 *
 * The webhook side proves *a repository* said something; this side proves *a
 * person* did. A GitHub App carries its own OAuth credentials, so no second
 * OAuth App is needed: the same `client_id` that identifies the App to a
 * repository identifies a user who authorizes it.
 *
 * The user access token GitHub returns here is used once, to read the identity
 * behind it, and then dropped. ProofForge acts on repositories with installation
 * tokens, never with a person's token, so keeping one would be storing a
 * credential the platform has no use for.
 *
 * The `state` parameter is signed rather than stored. A callback can land on any
 * instance behind a load balancer, and state kept in one process's memory would
 * fail intermittently on every deployment with more than one replica — the worst
 * kind of failure, because it looks like a flaky login.
 *
 * A signature alone proves only that *this service* issued the state, never that
 * it issued it to *this browser*. Without that second half, an attacker can
 * authorize with their own account, capture their callback URL before using it,
 * and send it to someone else — whose browser then completes a login into the
 * attacker's account (RFC 6749 §10.12). So the state carries a nonce that is
 * also handed to the browser as a short-lived cookie, and the callback requires
 * the two to match. The browser holds it, so this stays correct across replicas.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "./auth.js";

/** GitHub's OAuth endpoints live on the site, not on the API host. */
export const GITHUB_OAUTH_BASE_URL = "https://github.com";

/**
 * How long an authorization may stay in flight. Long enough for a person to read
 * the consent screen and, if needed, complete two-factor; short enough that a
 * state value copied out of a browser's history is worthless.
 */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * `read:user` covers the profile; `user:email` is what makes a private primary
 * address readable. Neither grants any repository access — that stays with the
 * installation, which the user's grant does not widen.
 */
export const DEFAULT_SCOPES = "read:user user:email";

export interface StatePayload {
  /** Where to send the browser once a session exists. Always a same-site path. */
  redirectTo: string;
  /**
   * Makes two otherwise identical states differ, and — because the same value
   * goes to the browser as a cookie — ties this login to the browser that began
   * it. See {@link bindingMatches}.
   */
  nonce: string;
  expiresAtMs: number;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export interface IssuedState {
  /** Goes to GitHub as the `state` parameter. */
  value: string;
  /** Goes to the browser, and has to come back. */
  nonce: string;
}

/**
 * Pack the round trip's context into a tamper-evident string.
 *
 * `redirectTo` travels inside the signature rather than as its own query
 * parameter, so the page a login lands on cannot be rewritten in flight. The
 * nonce is returned alongside because the caller has to give it to the browser.
 */
export function createState(
  secret: string,
  redirectTo: string,
  nowMs: number = Date.now(),
): IssuedState {
  const payload: StatePayload = {
    redirectTo,
    nonce: randomBytes(16).toString("base64url"),
    expiresAtMs: nowMs + STATE_TTL_MS,
  };
  const body = base64UrlJson(payload);
  return { value: `${body}.${sign(secret, body)}`, nonce: payload.nonce };
}

/** Returns the payload, or null for anything not provably ours and still valid. */
export function verifyState(
  secret: string,
  state: string,
  nowMs: number = Date.now(),
): StatePayload | null {
  const separator = state.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = state.slice(0, separator);
  const provided = Buffer.from(state.slice(separator + 1), "base64url");
  const expected = Buffer.from(sign(secret, body), "base64url");
  // timingSafeEqual throws on a length mismatch, and a length difference is
  // public information anyway — the comparison that must not leak is byte-wise.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }

  // Every field is checked, including the nonce a caller will hand straight to
  // bindingMatches: a payload that survives this must be usable, not merely ours.
  if (
    typeof payload?.redirectTo !== "string" ||
    typeof payload?.nonce !== "string" ||
    payload.nonce === "" ||
    typeof payload?.expiresAtMs !== "number"
  ) {
    return null;
  }
  if (payload.expiresAtMs <= nowMs) return null;
  return payload;
}

/**
 * Does the value the browser brought back match the one this state was issued
 * with? A callback that cannot answer yes was not started by this browser.
 */
export function bindingMatches(payload: StatePayload, presented: string | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(payload.nonce, "utf8");
  const actual = Buffer.from(presented, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export interface AuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string;
  oauthBaseUrl?: string;
}

/** The URL the browser is sent to for consent. */
export function authorizeUrl(options: AuthorizeUrlOptions): string {
  const url = new URL("/login/oauth/authorize", options.oauthBaseUrl ?? GITHUB_OAUTH_BASE_URL);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);
  url.searchParams.set("scope", options.scopes ?? DEFAULT_SCOPES);
  return url.toString();
}

export interface ExchangeOptions {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  oauthBaseUrl?: string;
  fetchImpl?: FetchLike;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Trade the one-time code for a user access token.
 *
 * GitHub reports OAuth failures as HTTP 200 with an `error` field, so a check on
 * `response.ok` alone would read "the code was already used" as success and hand
 * back `undefined`.
 */
export async function exchangeCodeForToken(options: ExchangeOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const url = new URL("/login/oauth/access_token", options.oauthBaseUrl ?? GITHUB_OAUTH_BASE_URL);

  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "proofforge",
    },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
  });

  // The request body holds the client secret, so failures report the status and
  // GitHub's own error code — never the exchange itself.
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const body = (await response.json().catch(() => ({}))) as AccessTokenResponse;
  if (body.error) {
    throw new Error(`GitHub token exchange rejected: ${body.error}`);
  }
  if (!body.access_token) {
    throw new Error("GitHub token exchange returned no access token");
  }
  return body.access_token;
}

/** A person, as GitHub describes them. `email` is null when none is readable. */
export interface GitHubIdentity {
  /** GitHub's numeric id, as a string: it is the only stable handle. A login can be renamed. */
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface IdentityOptions {
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

interface UserResponse {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface EmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

function get(url: string, accessToken: string, fetchImpl: FetchLike): Promise<Response> {
  return fetchImpl(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "proofforge",
    },
  });
}

/**
 * Read the identity a user token belongs to.
 *
 * `/user` omits the email whenever the profile keeps it private, which is the
 * default for a lot of accounts — so a null there is normal, not an error, and
 * `/user/emails` is consulted before giving up. Only a *verified* address is
 * accepted: an unverified one proves nothing about who is signing in.
 */
export async function fetchIdentity(
  accessToken: string,
  options: IdentityOptions = {},
): Promise<GitHubIdentity> {
  const apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));

  const response = await get(`${apiBaseUrl}/user`, accessToken, fetchImpl);
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed: ${response.status}`);
  }
  const user = (await response.json()) as UserResponse;
  // A 200 of the wrong shape would otherwise become an account keyed on the
  // string "undefined" — a failure that survives as data instead of an error.
  if (typeof user?.id !== "number" || typeof user?.login !== "string" || user.login === "") {
    throw new Error("GitHub user lookup returned no usable identity");
  }

  let email = user.email;
  if (!email) {
    email = await fetchPrimaryEmail(accessToken, apiBaseUrl, fetchImpl);
  }

  return {
    id: String(user.id),
    login: user.login,
    name: user.name,
    email,
    avatarUrl: user.avatar_url,
  };
}

/**
 * A missing email is recoverable — the account still exists and the token is
 * still good — so a failure here returns null rather than failing the login.
 */
async function fetchPrimaryEmail(
  accessToken: string,
  apiBaseUrl: string,
  fetchImpl: FetchLike,
): Promise<string | null> {
  const response = await get(`${apiBaseUrl}/user/emails`, accessToken, fetchImpl).catch(() => null);
  if (!response?.ok) return null;

  const emails = (await response.json().catch(() => [])) as EmailResponse[];
  if (!Array.isArray(emails)) return null;

  const verified = emails.filter((entry) => entry?.verified && typeof entry.email === "string");
  return verified.find((entry) => entry.primary)?.email ?? verified[0]?.email ?? null;
}
