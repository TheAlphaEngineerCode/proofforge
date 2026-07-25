/**
 * Bearer-token session auth.
 *
 * A preHandler resolves the session user (if any) onto `request.user`. Routes
 * that require a user call {@link requireUser}, which throws 401 when absent.
 * GitHub OAuth and the dev-login route issue the same session tokens; which of
 * the two a deployment offers is a matter of configuration, not of this plugin.
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

/** The bearer token on a request, or null if there isn't a well-formed one. */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function registerAuth(app: FastifyInstance, storage: Storage): void {
  app.decorateRequest("user", null);

  app.addHook("preHandler", async (request) => {
    const token = bearerToken(request);
    request.user = token ? await storage.getSessionUser(token) : null;
  });
}

export function requireUser(request: FastifyRequest): User {
  if (!request.user) throw unauthorized();
  return request.user;
}
