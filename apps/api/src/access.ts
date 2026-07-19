/**
 * Ownership checks. Every resource is reached through the organization that owns
 * it, and only that organization's owner may access it (tenant isolation).
 */
import type { Analysis, Repository } from "@proofforge/shared-types";
import type { AppDeps } from "./deps.js";
import { forbidden, notFound } from "./errors.js";

export async function assertOwnedOrg(deps: AppDeps, userId: string, orgId: string): Promise<void> {
  const org = await deps.storage.getOrganization(orgId);
  if (!org) throw notFound("organization not found");
  if (org.ownerId !== userId) throw forbidden("you do not have access to this organization");
}

export async function getOwnedRepository(
  deps: AppDeps,
  userId: string,
  repositoryId: string,
): Promise<Repository> {
  const repo = await deps.storage.getRepository(repositoryId);
  if (!repo) throw notFound("repository not found");
  await assertOwnedOrg(deps, userId, repo.organizationId);
  return repo;
}

export async function getOwnedAnalysis(
  deps: AppDeps,
  userId: string,
  analysisId: string,
): Promise<Analysis> {
  const analysis = await deps.storage.getAnalysis(analysisId);
  if (!analysis) throw notFound("analysis not found");
  await getOwnedRepository(deps, userId, analysis.repositoryId);
  return analysis;
}
