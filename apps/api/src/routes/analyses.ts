import type { FastifyInstance, FastifyRequest } from "fastify";
import { EVENT_SCHEMA_VERSION, type AnalysisEvent } from "@proofforge/shared-types";
import type { AppDeps } from "../deps.js";
import { getOwnedAnalysis } from "../access.js";
import { unauthorized } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

/** Comfortably inside the 60s idle timeout most proxies default to. */
const HEARTBEAT_MS = 20_000;

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
    // Writing to a socket the client already dropped does not throw — it raises
    // an error event, and an unhandled one on a hijacked reply takes the process
    // with it. The close handler below tears the stream down, but it cannot win
    // every race against a timer or an event that is already in flight.
    const write = (chunk: string): void => {
      if (!raw.destroyed) raw.write(chunk);
    };

    write(": connected\n\n");

    const send = (event: AnalysisEvent): void => {
      write(`data: ${JSON.stringify(event)}\n\n`);
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

    // An analysis can sit in one step for minutes, and a stream with nothing on
    // it looks identical to a dead one: proxies and hosting tiers close idle
    // connections, and the browser only learns about it when it reconnects. A
    // comment line keeps the connection accountable without being an event.
    const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
    heartbeat.unref();

    const unsubscribe = deps.events.subscribe(id, send);
    const release = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.raw.on("close", () => {
      release();
      raw.end();
    });
    // A socket that fails outright never reports a clean close, and a timer left
    // running on it would keep firing at a stream nobody is reading.
    raw.on("error", release);
  });
}

async function resolveUser(deps: AppDeps, request: FastifyRequest) {
  if (request.user) return request.user;
  const token = (request.query as { token?: string }).token;
  const user = token ? await deps.storage.getSessionUser(token) : null;
  if (!user) throw unauthorized();
  return user;
}
