/**
 * GitHub App authentication.
 *
 * The app signs a short-lived RS256 JWT with its private key, then exchanges it
 * for an installation access token scoped to a single installation. Installation
 * tokens live for an hour; they are cached in memory only and never persisted.
 */
import { createSign } from "node:crypto";

/** GitHub rejects JWTs with more than 10 minutes of life; stay comfortably under. */
const JWT_LIFETIME_S = 540;
/** Clock-skew allowance recommended by GitHub. */
const JWT_BACKDATE_S = 60;
/** Refresh an installation token this long before it actually expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

function base64Url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input, "utf8") : input).toString("base64url");
}

/** Build a signed app JWT. `nowMs` is injectable so the result is testable. */
export function createAppJwt(appId: string, privateKeyPem: string, nowMs: number = Date.now()): string {
  const nowS = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iat: nowS - JWT_BACKDATE_S, exp: nowS + JWT_LIFETIME_S, iss: appId }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = base64Url(signer.sign(privateKeyPem));

  return `${header}.${payload}.${signature}`;
}

export interface InstallationToken {
  token: string;
  expiresAtMs: number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface AppAuthOptions {
  appId: string;
  privateKey: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

/**
 * Issues and caches installation access tokens, one entry per installation.
 */
export class InstallationTokenProvider {
  private readonly cache = new Map<number, InstallationToken>();
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly options: AppAuthOptions) {
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
  }

  async getToken(installationId: number): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return cached.token;
    }

    const jwt = createAppJwt(this.options.appId, this.options.privateKey, this.now());
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "proofforge",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `failed to create installation token for ${installationId}: ${response.status}`,
      );
    }

    const body = (await response.json()) as { token: string; expires_at: string };
    const token: InstallationToken = {
      token: body.token,
      expiresAtMs: Date.parse(body.expires_at),
    };
    this.cache.set(installationId, token);
    return token.token;
  }

  /** Drop a cached token (e.g. after a 401), forcing a refresh on next use. */
  invalidate(installationId: number): void {
    this.cache.delete(installationId);
  }
}
