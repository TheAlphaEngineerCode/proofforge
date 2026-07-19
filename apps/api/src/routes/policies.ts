import type { FastifyInstance } from "fastify";
import { CreatePolicyInput } from "@proofforge/shared-types";
import type { AppDeps } from "../deps.js";
import { assertOwnedOrg } from "../access.js";
import { badRequest, notFound, parse } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

export function policyRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/policies", async (request) => {
    const user = requireUser(request);
    const query = request.query as { organizationId?: string };
    if (!query.organizationId) throw badRequest("organizationId query parameter is required");
    await assertOwnedOrg(deps, user.id, query.organizationId);
    return deps.storage.listPolicies(query.organizationId);
  });

  app.post("/api/v1/policies", async (request, reply) => {
    const user = requireUser(request);
    const input = parse(CreatePolicyInput, request.body ?? {});
    await assertOwnedOrg(deps, user.id, input.organizationId);
    const policy = await deps.storage.createPolicy(input);
    void reply.status(201);
    return policy;
  });

  app.post("/api/v1/policies/:id/validate", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const policy = await deps.storage.getPolicy(id);
    if (!policy) throw notFound("policy not found");
    await assertOwnedOrg(deps, user.id, policy.organizationId);

    // Structural check only. Schema-aware validation and enforcement land with
    // the Policy Engine (Phase 6).
    const valid = policy.content.trim().length > 0;
    return {
      valid,
      policyId: policy.id,
      message: valid
        ? "structural check passed; full policy validation arrives in Phase 6"
        : "policy content is empty",
    };
  });
}
