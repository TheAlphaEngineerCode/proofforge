import type { FastifyInstance } from "fastify";
import { CreateOrganizationInput } from "@proofforge/shared-types";
import type { AppDeps } from "../deps.js";
import { parse } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

export function organizationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/organizations", async (request) => {
    const user = requireUser(request);
    return deps.storage.listOrganizations(user.id);
  });

  app.post("/api/v1/organizations", async (request, reply) => {
    const user = requireUser(request);
    const input = parse(CreateOrganizationInput, request.body ?? {});
    const org = await deps.storage.createOrganization({
      name: input.name,
      slug: input.slug,
      ownerId: user.id,
    });
    void reply.status(201);
    return org;
  });
}
