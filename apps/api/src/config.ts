import { z } from "zod";

const ConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().positive().default(3001),
  databaseUrl: z.string().optional(),
  /** Enables POST /api/v1/auth/dev-login. Never enable in production. */
  devLogin: z.coerce.boolean().default(true),
  webOrigin: z.string().default("http://localhost:3000"),
  /** Milliseconds between simulated pipeline steps (0 in tests for speed). */
  pipelineStepMs: z.coerce.number().int().nonnegative().default(400),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = ConfigSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    devLogin: env.AUTH_DEV_LOGIN,
    webOrigin: env.WEB_BASE_URL,
    pipelineStepMs: env.PIPELINE_STEP_MS,
  });

  // Never expose the credential-free dev-login in production, whatever the env says.
  if (config.nodeEnv === "production") {
    return { ...config, devLogin: false };
  }
  return config;
}
