/**
 * Liveness, readiness, and the one thing a reader most needs to know about an
 * instance: whether the manifests it produces describe a real run.
 *
 * An instance with no evidence pipeline still answers every request and still
 * emits a schema-valid manifest — a simulated one. That is a legitimate mode for
 * a demo, and a disaster to mistake for the real thing, so it is reported rather
 * than left to be inferred from configuration nobody can see. It is the same rule
 * the manifest's own `collectors[]` field exists to enforce: say what was not
 * measured instead of letting a result imply it was.
 *
 * `configured` is deliberately not `collected`: it says the pipeline is wired,
 * which is all a process-level answer can honestly claim. A single analysis can
 * still degrade — an unreachable repository, a missing engine — and when it does,
 * that manifest says so itself.
 */
import type { FastifyInstance } from "fastify";
import { evidenceMode } from "../config.js";
import type { AppDeps } from "../deps.js";

export function healthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async () => ({
    status: "ready",
    evidence: evidenceMode(deps.config),
  }));
}
