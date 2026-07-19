import type { FastifyInstance, FastifyRequest } from "fastify";
import { EVENT_SCHEMA_VERSION, type AnalysisEvent } from "@proofforge/shared-types";
import type { AppDeps } from "../deps.js";
import { getOwnedAnalysis } from "../access.js";
import { unauthorized } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

export function analysisRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/analyses/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    return getOwnedAnalysis(deps, user.id, id);
  });

  // Server-Sent Events stream of status transitions for an analysis.
  app.get("/api/v1/analyses/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    // EventSource cannot set headers, so allow a token query param as a fallback.
    const user = await resolveUser(deps, request);
    const analysis = await getOwnedAnalysis(deps, user.id, id);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": deps.config.webOrigin,
    });
    raw.write(": connected\n\n");

    const send = (event: AnalysisEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Immediately emit the current status so late subscribers are in sync.
    send({
      version: EVENT_SCHEMA_VERSION,
      type: "status",
      analysisId: id,
      status: analysis.status,
      previousStatus: null,
      at: new Date().toISOString(),
    });

    const unsubscribe = deps.events.subscribe(id, send);
    request.raw.on("close", () => {
      unsubscribe();
      raw.end();
    });
  });
}

async function resolveUser(deps: AppDeps, request: FastifyRequest) {
  if (request.user) return request.user;
  const token = (request.query as { token?: string }).token;
  const user = token ? await deps.storage.getSessionUser(token) : null;
  if (!user) throw unauthorized();
  return user;
}
