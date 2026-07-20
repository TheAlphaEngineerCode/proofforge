import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { AppDeps } from "./deps.js";
import { registerErrorHandler } from "./errors.js";
import { registerAuth } from "./plugins/auth.js";
import { analysisRoutes } from "./routes/analyses.js";
import { authRoutes } from "./routes/auth.js";
import { evidenceBundleRoutes } from "./routes/evidence-bundles.js";
import { githubWebhookRoutes } from "./routes/github-webhook.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { organizationRoutes } from "./routes/organizations.js";
import { policyRoutes } from "./routes/policies.js";
import { repositoryRoutes } from "./routes/repositories.js";

/** Strip a `token` query value from a URL so SSE session tokens never hit the logs. */
export function redactToken(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, "$1REDACTED");
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      deps.config.nodeEnv === "test"
        ? false
        : {
            serializers: {
              req(request: FastifyRequest) {
                return {
                  method: request.method,
                  url: redactToken(request.url),
                  hostname: request.hostname,
                  remoteAddress: request.ip,
                };
              },
            },
          },
  });

  await app.register(cors, { origin: deps.config.webOrigin, credentials: true });

  registerErrorHandler(app);
  registerAuth(app, deps.storage);

  healthRoutes(app);
  metricsRoutes(app, deps);
  authRoutes(app, deps);
  organizationRoutes(app, deps);
  repositoryRoutes(app, deps);
  analysisRoutes(app, deps);
  evidenceBundleRoutes(app, deps);
  policyRoutes(app, deps);
  await githubWebhookRoutes(app, deps);

  return app;
}
