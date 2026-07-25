/**
 * Data transfer objects shared between the API and the web dashboard.
 *
 * Zod schemas double as runtime validators (API input) and the source of the TS
 * types (API output), so client and server never drift.
 */
import { z } from "zod";
import { ANALYSIS_STATUSES } from "./states.js";

export const RiskLevel = z.enum(["low", "moderate", "elevated", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

// ── entities ────────────────────────────────────────────────────────────────

export const User = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().url().nullable(),
  githubUserId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type User = z.infer<typeof User>;

export const Organization = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  ownerId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Organization = z.infer<typeof Organization>;

export const Repository = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  language: z.string().nullable(),
  private: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Repository = z.infer<typeof Repository>;

export const Analysis = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  commitSha: z.string(),
  status: z.enum(ANALYSIS_STATUSES),
  riskScore: z.number().int().min(0).max(100).nullable(),
  riskLevel: RiskLevel.nullable(),
  evidenceBundleId: z.string().uuid().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Analysis = z.infer<typeof Analysis>;

export const EvidenceBundle = z.object({
  id: z.string().uuid(),
  analysisId: z.string().uuid(),
  commitSha: z.string(),
  manifestVersion: z.string(),
  riskScore: z.number().int().min(0).max(100),
  evidenceHash: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;

export const Policy = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  version: z.string(),
  content: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Policy = z.infer<typeof Policy>;

// ── request bodies ───────────────────────────────────────────────────────────

/**
 * What GitHub itself allows, and no more.
 *
 * These three are stored, but they are also read back out to build the remote URL
 * and the ref of a `git fetch` — so whoever supplies them is writing part of a
 * command line. Nothing is spawned through a shell, but git still reads an
 * argument beginning with `-` as an option rather than a ref.
 *
 * The commit is held to a hexadecimal sha for a second reason. Evidence is bound
 * to a commit, and a manifest whose `commit` is a string nobody can resolve makes
 * a provenance claim that cannot be checked — which is the one thing this project
 * exists to prevent.
 */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
export const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

export const CreateOrganizationInput = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationInput>;

export const CreateRepositoryInput = z.object({
  organizationId: z.string().uuid(),
  owner: z.string().regex(OWNER, "owner must be a GitHub account name"),
  name: z.string().regex(REPO_NAME, "name must be a GitHub repository name"),
  defaultBranch: z.string().min(1).max(255).default("main"),
  language: z.string().nullable().default(null),
  private: z.boolean().default(false),
});
export type CreateRepositoryInput = z.infer<typeof CreateRepositoryInput>;

export const CreateAnalysisInput = z.object({
  commitSha: z.string().regex(COMMIT_SHA, "commitSha must be a hexadecimal git object name"),
});
export type CreateAnalysisInput = z.infer<typeof CreateAnalysisInput>;

export const CreatePolicyInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  version: z.string().min(1).default("1.0"),
  content: z.string().min(1),
  active: z.boolean().default(true),
});
export type CreatePolicyInput = z.infer<typeof CreatePolicyInput>;
