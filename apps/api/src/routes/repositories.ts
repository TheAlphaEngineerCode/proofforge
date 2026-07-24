import type { FastifyInstance } from "fastify";
import { CreateAnalysisInput, CreateRepositoryInput } from "@proofforge/shared-types";
import type { AppDeps } from "../deps.js";
import { assertOwnedOrg, getOwnedRepository } from "../access.js";
import { badRequest, parse } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

export function repositoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/repositories", async (request) => {
    const user = requireUser(request);
    const query = request.query as { organizationId?: string };
    if (!query.organizationId) throw badRequest("organizationId query parameter is required");
    await assertOwnedOrg(deps, user.id, query.organizationId);
    return deps.storage.listRepositories(query.organizationId);
  });

  app.post("/api/v1/repositories", async (request, reply) => {
    const user = requireUser(request);
    const input = parse(CreateRepositoryInput, request.body ?? {});
    await assertOwnedOrg(deps, user.id, input.organizationId);
    const repo = await deps.storage.createRepository(input);
    void reply.status(201);
    return repo;
  });

  app.get("/api/v1/repositories/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    return getOwnedRepository(deps, user.id, id);
  });

  app.get("/api/v1/repositories/:id/analyses", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await getOwnedRepository(deps, user.id, id);
    return deps.storage.listAnalyses(id);
  });

  app.post("/api/v1/repositories/:id/analyze", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const input = parse(CreateAnalysisInput, request.body ?? {});
    await getOwnedRepository(deps, user.id, id);

    const analysis = await deps.storage.createAnalysis({
      repositoryId: id,
      commitSha: input.commitSha,
    });
    // Fire-and-forget: the pipeline runs asynchronously and streams events.
    // A manually-triggered analysis has nowhere to report back to, so no publish.
    // A rejected enqueue (a Redis fault) is logged, not thrown: it must not
    // become an unhandled rejection that takes the API down. The analysis stays
    // in its created state, visible as never having started.
    void deps.queue.enqueue({ analysisId: analysis.id }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[api] failed to enqueue analysis ${analysis.id}: ${message}`);
    });

    void reply.status(202);
    return analysis;
  });
}
