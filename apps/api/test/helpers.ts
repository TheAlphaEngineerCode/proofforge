import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDeps } from "../src/factory.js";
import type { AppDeps } from "../src/deps.js";

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
}

export async function setup(): Promise<TestApp> {
  const config = loadConfig({ NODE_ENV: "test", AUTH_DEV_LOGIN: "true", PIPELINE_STEP_MS: "0" });
  const deps = createDeps(config);
  const app = await buildApp(deps);
  return { app, deps };
}

export async function login(app: FastifyInstance): Promise<{ token: string; userId: string }> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/dev-login", payload: {} });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
