/**
 * The scrape endpoint.
 *
 * Unauthenticated on purpose, and that is a deployment constraint rather than
 * an oversight: the series names and label values here describe repositories
 * and collectors, so this port belongs on an internal network, not the public
 * internet. Nothing per-user or per-secret is exposed, but "which repos are
 * analysed here" is still information.
 */
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

export function metricsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/metrics", async (_request, reply) => {
    // The version suffix is part of the format; a scraper uses it to pick a parser.
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return deps.metrics.render();
  });
}
