import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { getOwnedAnalysis } from "../access.js";
import { notFound } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

export function evidenceBundleRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/evidence-bundles/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const bundle = await loadOwnedBundle(deps, user.id, id);
    return bundle;
  });

  app.get("/api/v1/evidence-bundles/:id/manifest", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await loadOwnedBundle(deps, user.id, id);
    const manifest = await deps.storage.getManifest(id);
    if (manifest === null) throw notFound("manifest not found");
    return manifest;
  });
}

async function loadOwnedBundle(deps: AppDeps, userId: string, bundleId: string) {
  const bundle = await deps.storage.getEvidenceBundle(bundleId);
  if (!bundle) throw notFound("evidence bundle not found");
  // Authorize via the owning analysis → repository → organization chain.
  await getOwnedAnalysis(deps, userId, bundle.analysisId);
  return bundle;
}
