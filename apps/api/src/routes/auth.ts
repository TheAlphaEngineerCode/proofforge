import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { parse } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

const DevLoginInput = z.object({
  name: z.string().min(1).default("Dev User"),
  email: z.string().email().default("dev@proofforge.local"),
});

export function authRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/me", async (request) => {
    return requireUser(request);
  });

  if (deps.config.devLogin) {
    app.post("/api/v1/auth/dev-login", async (request, reply) => {
      const input = parse(DevLoginInput, request.body ?? {});
      const user = await deps.storage.createUser({
        name: input.name,
        email: `${Date.now()}.${input.email}`,
        avatarUrl: null,
        githubUserId: null,
      });
      const session = await deps.storage.createSession(user.id);
      void reply.status(201);
      return { token: session.token, expiresAt: session.expiresAt, user };
    });
  }

  // Placeholder for the GitHub OAuth flow wired in Phase 5.
  app.get("/api/v1/auth/github", async () => {
    return { status: "not_configured", phase: 5 };
  });
}
