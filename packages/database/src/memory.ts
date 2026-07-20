/**
 * In-memory storage backend.
 *
 * A real, fully-functional implementation of {@link Storage} backed by Maps. It
 * is the default for local development and the substrate for the API's tests, so
 * the whole API surface runs with no database. Production swaps in the
 * PostgreSQL backend behind the same interface.
 */
import { randomUUID } from "node:crypto";
import type {
  Analysis,
  EvidenceBundle,
  Organization,
  Policy,
  Repository,
  User,
} from "@proofforge/shared-types";
import type {
  AnalysisUpdate,
  AuditLog,
  Installation,
  NewAnalysis,
  NewAuditLog,
  NewEvidenceBundle,
  NewInstallation,
  NewOrganization,
  NewPolicy,
  NewRepository,
  NewUser,
  Session,
  Storage,
} from "./storage.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export class InMemoryStorage implements Storage {
  private readonly users = new Map<string, User>();
  private readonly sessions = new Map<string, { userId: string; expiresAt: number }>();
  private readonly organizations = new Map<string, Organization>();
  private readonly repositories = new Map<string, Repository>();
  private readonly analyses = new Map<string, Analysis>();
  private readonly bundles = new Map<string, EvidenceBundle>();
  private readonly manifests = new Map<string, unknown>();
  private readonly policies = new Map<string, Policy>();
  private readonly installations = new Map<number, Installation>();
  /** Append-only: an audit trail that can be edited is not one. */
  private readonly auditLogs: AuditLog[] = [];

  private now(): string {
    return new Date().toISOString();
  }

  async createUser(input: NewUser): Promise<User> {
    const user: User = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      avatarUrl: input.avatarUrl ?? null,
      githubUserId: input.githubUserId ?? null,
      createdAt: this.now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async getUserByGithubId(githubUserId: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.githubUserId === githubUserId) return user;
    }
    return null;
  }

  async createSession(userId: string): Promise<Session> {
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(token, { userId, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async getSessionUser(token: string): Promise<User | null> {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return this.users.get(session.userId) ?? null;
  }

  async createOrganization(input: NewOrganization): Promise<Organization> {
    const org: Organization = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
      createdAt: this.now(),
    };
    this.organizations.set(org.id, org);
    return org;
  }

  async listOrganizations(ownerId: string): Promise<Organization[]> {
    return [...this.organizations.values()].filter((o) => o.ownerId === ownerId);
  }

  async getOrganization(id: string): Promise<Organization | null> {
    return this.organizations.get(id) ?? null;
  }

  async createRepository(input: NewRepository): Promise<Repository> {
    const repo: Repository = {
      id: randomUUID(),
      organizationId: input.organizationId,
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch,
      language: input.language,
      private: input.private,
      createdAt: this.now(),
    };
    this.repositories.set(repo.id, repo);
    return repo;
  }

  async listRepositories(organizationId: string): Promise<Repository[]> {
    return [...this.repositories.values()].filter((r) => r.organizationId === organizationId);
  }

  async getRepository(id: string): Promise<Repository | null> {
    return this.repositories.get(id) ?? null;
  }

  async findRepositoryByFullName(owner: string, name: string): Promise<Repository | null> {
    for (const repo of this.repositories.values()) {
      if (repo.owner === owner && repo.name === name) return repo;
    }
    return null;
  }

  async upsertInstallation(input: NewInstallation): Promise<Installation> {
    const existing = this.installations.get(input.githubInstallationId);
    const installation: Installation = {
      id: existing?.id ?? randomUUID(),
      githubInstallationId: input.githubInstallationId,
      accountLogin: input.accountLogin ?? existing?.accountLogin ?? null,
      suspended: input.suspended ?? existing?.suspended ?? false,
      createdAt: existing?.createdAt ?? this.now(),
    };
    this.installations.set(installation.githubInstallationId, installation);
    return installation;
  }

  async getInstallation(githubInstallationId: number): Promise<Installation | null> {
    return this.installations.get(githubInstallationId) ?? null;
  }

  async deleteInstallation(githubInstallationId: number): Promise<void> {
    this.installations.delete(githubInstallationId);
  }

  async createAnalysis(input: NewAnalysis): Promise<Analysis> {
    const timestamp = this.now();
    const analysis: Analysis = {
      id: randomUUID(),
      repositoryId: input.repositoryId,
      commitSha: input.commitSha,
      status: "CREATED",
      riskScore: null,
      riskLevel: null,
      evidenceBundleId: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.analyses.set(analysis.id, analysis);
    return analysis;
  }

  async getAnalysis(id: string): Promise<Analysis | null> {
    return this.analyses.get(id) ?? null;
  }

  async updateAnalysis(id: string, update: AnalysisUpdate): Promise<Analysis> {
    const current = this.analyses.get(id);
    if (!current) throw new Error(`analysis not found: ${id}`);
    const updated: Analysis = {
      ...current,
      ...update,
      updatedAt: this.now(),
    };
    this.analyses.set(id, updated);
    return updated;
  }

  async listAnalyses(repositoryId: string): Promise<Analysis[]> {
    return [...this.analyses.values()]
      .filter((a) => a.repositoryId === repositoryId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createEvidenceBundle(input: NewEvidenceBundle): Promise<EvidenceBundle> {
    const bundle: EvidenceBundle = {
      id: randomUUID(),
      analysisId: input.analysisId,
      commitSha: input.commitSha,
      manifestVersion: input.manifestVersion,
      riskScore: input.riskScore,
      evidenceHash: input.evidenceHash,
      createdAt: this.now(),
    };
    this.bundles.set(bundle.id, bundle);
    this.manifests.set(bundle.id, input.manifest);
    return bundle;
  }

  async getEvidenceBundle(id: string): Promise<EvidenceBundle | null> {
    return this.bundles.get(id) ?? null;
  }

  async getManifest(bundleId: string): Promise<unknown | null> {
    return this.manifests.get(bundleId) ?? null;
  }

  async createPolicy(input: NewPolicy): Promise<Policy> {
    const policy: Policy = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      version: input.version,
      content: input.content,
      active: input.active,
      createdAt: this.now(),
    };
    this.policies.set(policy.id, policy);
    return policy;
  }

  async listPolicies(organizationId: string): Promise<Policy[]> {
    return [...this.policies.values()].filter((p) => p.organizationId === organizationId);
  }

  async getPolicy(id: string): Promise<Policy | null> {
    return this.policies.get(id) ?? null;
  }

  async recordAuditLog(input: NewAuditLog): Promise<AuditLog> {
    const entry: AuditLog = {
      id: randomUUID(),
      organizationId: input.organizationId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
      createdAt: this.now(),
    };
    this.auditLogs.push(entry);
    return entry;
  }

  async listAuditLogs(organizationId: string): Promise<AuditLog[]> {
    // Reverse insertion order, not a sort on the timestamp. The list is
    // append-only, so insertion order is already chronological — and two entries
    // written in the same millisecond carry the same timestamp, which would make
    // a sort return them in an order nothing guarantees.
    return this.auditLogs.filter((entry) => entry.organizationId === organizationId).reverse();
  }
}
