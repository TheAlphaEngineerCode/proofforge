/**
 * The scrape endpoint.
 *
 * The series names and label values here describe the repositories this
 * deployment analyses. Nothing per-user or per-secret is exposed, but "which
 * repos are analysed here" is still information, and a public URL is a poor
 * place to publish it.
 *
 * So the endpoint follows the deployment: on a private network `METRICS_TOKEN`
 * can stay unset and any scraper may read it, while in production it is served
 * only when a token is configured. An unconfigured production deployment gets no
 * route at all rather than an open one — the same way dev-login is forced off
 * there instead of merely discouraged.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { bearerToken } from "../plugins/auth.js";

export function metricsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const token = deps.config.metricsToken;

  if (token === "" && deps.config.nodeEnv === "production") {
    // Say so at startup. A scrape target that quietly 404s reads like a broken
    // deployment, and this one is a decision.
    app.log.warn("[metrics] /metrics is not served: set METRICS_TOKEN to enable it");
    return;
  }

  app.get("/metrics", async (request, reply) => {
    if (token !== "" && !matches(bearerToken(request), token)) {
      void reply.status(401);
      return { error: "invalid metrics token" };
    }

    // The version suffix is part of the format; a scraper uses it to pick a parser.
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return deps.metrics.render();
  });
}

function matches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on a length mismatch, and a length difference leaks
  // nothing worth hiding — the comparison that must not leak is byte-wise.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
