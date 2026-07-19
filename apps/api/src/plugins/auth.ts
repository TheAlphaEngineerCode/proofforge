/**
 * Bearer-token session auth.
 *
 * A preHandler resolves the session user (if any) onto `request.user`. Routes
 * that require a user call {@link requireUser}, which throws 401 when absent.
 * GitHub OAuth (Phase 5) will issue the same session tokens; the dev-login route
 * issues them locally.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { User } from "@proofforge/shared-types";
import type { Storage } from "@proofforge/database";
import { unauthorized } from "../errors.js";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function registerAuth(app: FastifyInstance, storage: Storage): void {
  app.decorateRequest("user", null);

  app.addHook("preHandler", async (request) => {
    const token = extractToken(request);
    request.user = token ? await storage.getSessionUser(token) : null;
  });
}

export function requireUser(request: FastifyRequest): User {
  if (!request.user) throw unauthorized();
  return request.user;
}
