/**
 * The storage contract.
 *
 * Both the in-memory backend (local/dev/tests) and the PostgreSQL backend
 * (production) implement this interface, so the API is agnostic to where its data
 * lives. All methods are async so swapping backends never changes call sites.
 */
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

export interface NewUser {
  name: string;
  email: string;
  avatarUrl?: string | null;
  githubUserId?: string | null;
}

export interface NewOrganization {
  name: string;
  slug: string;
  ownerId: string;
}

export interface NewRepository {
  organizationId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  language: string | null;
  private: boolean;
}

export interface NewAnalysis {
  repositoryId: string;
  commitSha: string;
}

export interface AnalysisUpdate {
  status?: AnalysisStatus;
  riskScore?: number | null;
  riskLevel?: RiskLevel | null;
  evidenceBundleId?: string | null;
  error?: string | null;
}

export interface NewEvidenceBundle {
  analysisId: string;
  commitSha: string;
  manifestVersion: string;
  riskScore: number;
  evidenceHash: string;
  manifest: unknown;
}

export interface NewPolicy {
  organizationId: string;
  name: string;
  version: string;
  content: string;
  active: boolean;
}

export interface Session {
  token: string;
  expiresAt: string;
}

/** A GitHub App installation, recorded so webhooks can be authorized and routed. */
export interface Installation {
  id: string;
  githubInstallationId: number;
  accountLogin: string | null;
  suspended: boolean;
  createdAt: string;
}

export interface NewInstallation {
  githubInstallationId: number;
  accountLogin?: string | null;
  suspended?: boolean;
}

export interface Storage {
  createUser(input: NewUser): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByGithubId(githubUserId: string): Promise<User | null>;

  createSession(userId: string): Promise<Session>;
  getSessionUser(token: string): Promise<User | null>;

  createOrganization(input: NewOrganization): Promise<Organization>;
  listOrganizations(ownerId: string): Promise<Organization[]>;
  getOrganization(id: string): Promise<Organization | null>;

  createRepository(input: NewRepository): Promise<Repository>;
  listRepositories(organizationId: string): Promise<Repository[]>;
  getRepository(id: string): Promise<Repository | null>;
  /** Resolve a repository from the `owner/name` pair a webhook carries. */
  findRepositoryByFullName(owner: string, name: string): Promise<Repository | null>;

  upsertInstallation(input: NewInstallation): Promise<Installation>;
  getInstallation(githubInstallationId: number): Promise<Installation | null>;
  deleteInstallation(githubInstallationId: number): Promise<void>;

  createAnalysis(input: NewAnalysis): Promise<Analysis>;
  getAnalysis(id: string): Promise<Analysis | null>;
  updateAnalysis(id: string, update: AnalysisUpdate): Promise<Analysis>;
  listAnalyses(repositoryId: string): Promise<Analysis[]>;

  createEvidenceBundle(input: NewEvidenceBundle): Promise<EvidenceBundle>;
  getEvidenceBundle(id: string): Promise<EvidenceBundle | null>;
  getManifest(bundleId: string): Promise<unknown | null>;

  createPolicy(input: NewPolicy): Promise<Policy>;
  listPolicies(organizationId: string): Promise<Policy[]>;
  getPolicy(id: string): Promise<Policy | null>;
}
