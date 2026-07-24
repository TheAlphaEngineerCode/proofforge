import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * A boolean out of an environment variable, which is always a string.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, and `Boolean("false")` is `true` —
 * so the one spelling somebody uses to turn a flag off is the spelling that
 * turns it on. For a flag that gates a credential-free login, that is not a
 * quirk worth living with.
 */
function envBoolean(fallback: boolean) {
  return z
    .string()
    .optional()
    .transform((raw) =>
      raw === undefined || raw.trim() === ""
        ? fallback
        : !/^(0|false|no|off)$/i.test(raw.trim()),
    );
}

const ConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().positive().default(3001),
  databaseUrl: z.string().optional(),
  /**
   * When set, analyses are enqueued to Redis and run by separate workers;
   * otherwise the queue is in-process and runs them here. Distribution is opt-in
   * exactly like the database is.
   */
  redisUrl: z.string().optional(),
  /** Enables POST /api/v1/auth/dev-login. Never enable in production. */
  devLogin: envBoolean(true),
  webOrigin: z.string().default("http://localhost:3000"),
  /** Milliseconds between simulated pipeline steps (0 in tests for speed). */
  pipelineStepMs: z.coerce.number().int().nonnegative().default(400),

  /**
   * Path to services/evidence-engine. When set, analyses check the commit out and
   * collect real evidence; otherwise a simulated manifest is produced.
   */
  evidenceEngineDir: z.string().default(""),

  // GitHub App. Absent values simply disable the integration.
  githubAppId: z.string().default(""),
  githubPrivateKey: z.string().default(""),
  githubWebhookSecret: z.string().default(""),
  githubApiBaseUrl: z.string().default("https://api.github.com"),

  /**
   * The App's OAuth credentials, which sign people in. Absent, the GitHub login
   * routes report themselves unconfigured and only dev-login remains — which is
   * to say a production deployment without these has no way in at all.
   */
  githubClientId: z.string().default(""),
  githubClientSecret: z.string().default(""),
  /** Overridable so tests can point the flow at a local server. */
  githubOauthBaseUrl: z.string().default("https://github.com"),
  /** This API's own public origin; GitHub returns the browser here. */
  apiBaseUrl: z.string().default("http://localhost:3001"),
  /** HMAC key for the OAuth `state`. Generated per process when unset. */
  authStateSecret: z.string().default(""),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = ConfigSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    devLogin: env.AUTH_DEV_LOGIN,
    webOrigin: env.WEB_BASE_URL,
    pipelineStepMs: env.PIPELINE_STEP_MS,
    evidenceEngineDir: env.EVIDENCE_ENGINE_DIR,
    githubAppId: env.GITHUB_APP_ID,
    // A PEM cannot survive a single-line .env unless its newlines are escaped,
    // so accept both the escaped and the literal form.
    githubPrivateKey: env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    githubApiBaseUrl: env.GITHUB_API_BASE_URL,
    githubClientId: env.GITHUB_APP_CLIENT_ID,
    githubClientSecret: env.GITHUB_APP_CLIENT_SECRET,
    githubOauthBaseUrl: env.GITHUB_OAUTH_BASE_URL,
    apiBaseUrl: env.API_BASE_URL,
    authStateSecret: env.AUTH_STATE_SECRET,
  });

  const oauthConfigured = Boolean(config.githubClientId && config.githubClientSecret);

  if (config.nodeEnv === "production") {
    // A per-process secret works only while there is one process. Behind two
    // replicas the callback can land on the instance that did not issue the
    // state, and the login fails for reasons no log would explain — so in
    // production the secret is required rather than invented.
    if (oauthConfigured && !config.authStateSecret) {
      throw new Error(
        "AUTH_STATE_SECRET is required in production when GitHub OAuth is configured",
      );
    }
    // Never expose the credential-free dev-login in production, whatever the env says.
    return { ...config, devLogin: false };
  }

  return config.authStateSecret
    ? config
    : { ...config, authStateSecret: randomBytes(32).toString("hex") };
}
