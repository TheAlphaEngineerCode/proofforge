import type { FastifyInstance } from "fastify";

export function healthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async () => ({ status: "ready" }));
}
