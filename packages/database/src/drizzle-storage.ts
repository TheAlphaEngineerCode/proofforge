/**
 * PostgreSQL-backed storage.
 *
 * Implements the same {@link Storage} contract as the in-memory backend, so the
 * API is identical whichever one is running. Timestamps are stored as `timestamptz`
 * and surfaced as ISO strings, which is what the DTOs carry over the wire.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import type {
  Analysis,
  AnalysisStatus,
  EvidenceBundle,
  Organization,
  Policy,
  Repository,
  RiskLevel,
  User,
} from "@proofforge/shared-types";
import type { Database } from "./client.js";
import * as schema from "./schema.js";
import type {
  AnalysisUpdate,
  Installation,
  NewAnalysis,
  NewEvidenceBundle,
  NewInstallation,
  NewOrganization,
  NewPolicy,
  NewRepository,
  NewUser,
  Session,
  Storage,
} from "./storage.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type UserRow = typeof schema.users.$inferSelect;
type OrganizationRow = typeof schema.organizations.$inferSelect;
type RepositoryRow = typeof schema.repositories.$inferSelect;
type AnalysisRow = typeof schema.analyses.$inferSelect;
type EvidenceBundleRow = typeof schema.evidenceBundles.$inferSelect;
type PolicyRow = typeof schema.policies.$inferSelect;
type InstallationRow = typeof schema.installations.$inferSelect;

const iso = (value: Date): string => value.toISOString();

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    githubUserId: row.githubUserId,
    createdAt: iso(row.createdAt),
  };
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.ownerId,
    createdAt: iso(row.createdAt),
  };
}

function toRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    organizationId: row.organizationId,
    owner: row.owner,
    name: row.name,
    defaultBranch: row.defaultBranch,
    language: row.language,
    private: row.private,
    createdAt: iso(row.createdAt),
  };
}

function toAnalysis(row: AnalysisRow): Analysis {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    commitSha: row.commitSha,
    status: row.status as AnalysisStatus,
    riskScore: row.riskScore,
    riskLevel: row.riskLevel as RiskLevel | null,
    evidenceBundleId: row.evidenceBundleId,
    error: row.error,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toEvidenceBundle(row: EvidenceBundleRow): EvidenceBundle {
  return {
    id: row.id,
    analysisId: row.analysisId,
    commitSha: row.commitSha,
    manifestVersion: row.manifestVersion,
    riskScore: row.riskScore,
    evidenceHash: row.evidenceHash,
    createdAt: iso(row.createdAt),
  };
}

function toPolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    version: row.version,
    content: row.content,
    active: row.active,
    createdAt: iso(row.createdAt),
  };
}

function toInstallation(row: InstallationRow): Installation {
  return {
    id: row.id,
    githubInstallationId: row.githubInstallationId,
    accountLogin: row.accountLogin,
    suspended: row.suspended,
    createdAt: iso(row.createdAt),
  };
}

/** Every insert returns its row, so the caller always gets server-generated values. */
function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected the statement to return a row");
  return row;
}

export class DrizzleStorage implements Storage {
  constructor(private readonly db: Database) {}

  // ── users & sessions ──────────────────────────────────────────────────────

  async createUser(input: NewUser): Promise<User> {
    const rows = await this.db
      .insert(schema.users)
      .values({
        name: input.name,
        email: input.email,
        avatarUrl: input.avatarUrl ?? null,
        githubUserId: input.githubUserId ?? null,
      })
      .returning();
    return toUser(first(rows));
  }

  async getUser(id: string): Promise<User | null> {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserByGithubId(githubUserId: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.githubUserId, githubUserId))
      .limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async createSession(userId: string): Promise<Session> {
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(schema.sessions).values({ token, userId, expiresAt });
    return { token, expiresAt: iso(expiresAt) };
  }

  async getSessionUser(token: string): Promise<User | null> {
    const rows = await this.db
      .select({ user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, new Date())))
      .limit(1);
    return rows[0] ? toUser(rows[0].user) : null;
  }

  // ── organizations ─────────────────────────────────────────────────────────

  async createOrganization(input: NewOrganization): Promise<Organization> {
    const rows = await this.db.insert(schema.organizations).values(input).returning();
    return toOrganization(first(rows));
  }

  async listOrganizations(ownerId: string): Promise<Organization[]> {
    const rows = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.ownerId, ownerId));
    return rows.map(toOrganization);
  }

  async getOrganization(id: string): Promise<Organization | null> {
    const rows = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  // ── repositories ──────────────────────────────────────────────────────────

  async createRepository(input: NewRepository): Promise<Repository> {
    const rows = await this.db.insert(schema.repositories).values(input).returning();
    return toRepository(first(rows));
  }

  async listRepositories(organizationId: string): Promise<Repository[]> {
    const rows = await this.db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.organizationId, organizationId));
    return rows.map(toRepository);
  }

  async getRepository(id: string): Promise<Repository | null> {
    const rows = await this.db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, id))
      .limit(1);
    return rows[0] ? toRepository(rows[0]) : null;
  }

  async findRepositoryByFullName(owner: string, name: string): Promise<Repository | null> {
    const rows = await this.db
      .select()
      .from(schema.repositories)
      .where(and(eq(schema.repositories.owner, owner), eq(schema.repositories.name, name)))
      .limit(1);
    return rows[0] ? toRepository(rows[0]) : null;
  }

  // ── analyses ──────────────────────────────────────────────────────────────

  async createAnalysis(input: NewAnalysis): Promise<Analysis> {
    const rows = await this.db
      .insert(schema.analyses)
      .values({ repositoryId: input.repositoryId, commitSha: input.commitSha, status: "CREATED" })
      .returning();
    return toAnalysis(first(rows));
  }

  async getAnalysis(id: string): Promise<Analysis | null> {
    const rows = await this.db
      .select()
      .from(schema.analyses)
      .where(eq(schema.analyses.id, id))
      .limit(1);
    return rows[0] ? toAnalysis(rows[0]) : null;
  }

  async updateAnalysis(id: string, update: AnalysisUpdate): Promise<Analysis> {
    const rows = await this.db
      .update(schema.analyses)
      .set({
        ...(update.status === undefined ? {} : { status: update.status }),
        ...(update.riskScore === undefined ? {} : { riskScore: update.riskScore }),
        ...(update.riskLevel === undefined ? {} : { riskLevel: update.riskLevel }),
        ...(update.evidenceBundleId === undefined
          ? {}
          : { evidenceBundleId: update.evidenceBundleId }),
        ...(update.error === undefined ? {} : { error: update.error }),
        updatedAt: new Date(),
      })
      .where(eq(schema.analyses.id, id))
      .returning();

    const row = rows[0];
    if (!row) throw new Error(`analysis not found: ${id}`);
    return toAnalysis(row);
  }

  async listAnalyses(repositoryId: string): Promise<Analysis[]> {
    const rows = await this.db
      .select()
      .from(schema.analyses)
      .where(eq(schema.analyses.repositoryId, repositoryId))
      .orderBy(desc(schema.analyses.createdAt));
    return rows.map(toAnalysis);
  }

  // ── evidence bundles ──────────────────────────────────────────────────────

  async createEvidenceBundle(input: NewEvidenceBundle): Promise<EvidenceBundle> {
    const rows = await this.db
      .insert(schema.evidenceBundles)
      .values({
        analysisId: input.analysisId,
        commitSha: input.commitSha,
        manifestVersion: input.manifestVersion,
        riskScore: input.riskScore,
        evidenceHash: input.evidenceHash,
        manifest: input.manifest,
      })
      .returning();
    return toEvidenceBundle(first(rows));
  }

  async getEvidenceBundle(id: string): Promise<EvidenceBundle | null> {
    const rows = await this.db
      .select()
      .from(schema.evidenceBundles)
      .where(eq(schema.evidenceBundles.id, id))
      .limit(1);
    return rows[0] ? toEvidenceBundle(rows[0]) : null;
  }

  async getManifest(bundleId: string): Promise<unknown | null> {
    const rows = await this.db
      .select({ manifest: schema.evidenceBundles.manifest })
      .from(schema.evidenceBundles)
      .where(eq(schema.evidenceBundles.id, bundleId))
      .limit(1);
    return rows[0]?.manifest ?? null;
  }

  // ── policies ──────────────────────────────────────────────────────────────

  async createPolicy(input: NewPolicy): Promise<Policy> {
    const rows = await this.db.insert(schema.policies).values(input).returning();
    return toPolicy(first(rows));
  }

  async listPolicies(organizationId: string): Promise<Policy[]> {
    const rows = await this.db
      .select()
      .from(schema.policies)
      .where(eq(schema.policies.organizationId, organizationId));
    return rows.map(toPolicy);
  }

  async getPolicy(id: string): Promise<Policy | null> {
    const rows = await this.db
      .select()
      .from(schema.policies)
      .where(eq(schema.policies.id, id))
      .limit(1);
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  // ── installations ─────────────────────────────────────────────────────────

  async upsertInstallation(input: NewInstallation): Promise<Installation> {
    const rows = await this.db
      .insert(schema.installations)
      .values({
        githubInstallationId: input.githubInstallationId,
        accountLogin: input.accountLogin ?? null,
        suspended: input.suspended ?? false,
      })
      .onConflictDoUpdate({
        target: schema.installations.githubInstallationId,
        set: {
          accountLogin: input.accountLogin ?? null,
          suspended: input.suspended ?? false,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toInstallation(first(rows));
  }

  async getInstallation(githubInstallationId: number): Promise<Installation | null> {
    const rows = await this.db
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.githubInstallationId, githubInstallationId))
      .limit(1);
    return rows[0] ? toInstallation(rows[0]) : null;
  }

  async deleteInstallation(githubInstallationId: number): Promise<void> {
    await this.db
      .delete(schema.installations)
      .where(eq(schema.installations.githubInstallationId, githubInstallationId));
  }
}
