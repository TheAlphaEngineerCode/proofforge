import { describe, expect, it } from "vitest";
import { InMemoryStorage } from "../src/memory.js";

async function seedOrgRepo(storage: InMemoryStorage) {
  const user = await storage.createUser({ name: "Ada", email: "ada@example.com" });
  const org = await storage.createOrganization({ name: "Acme", slug: "acme", ownerId: user.id });
  const repo = await storage.createRepository({
    organizationId: org.id,
    owner: "acme",
    name: "api",
    defaultBranch: "main",
    language: "TypeScript",
    private: false,
  });
  return { user, org, repo };
}

describe("InMemoryStorage", () => {
  it("round-trips users and resolves them by github id", async () => {
    const storage = new InMemoryStorage();
    const user = await storage.createUser({
      name: "Ada",
      email: "ada@example.com",
      githubUserId: "gh-42",
    });
    expect(await storage.getUser(user.id)).toEqual(user);
    expect(await storage.getUserByGithubId("gh-42")).toEqual(user);
    expect(await storage.getUserByGithubId("missing")).toBeNull();
  });

  it("creates and validates sessions, expiring unknown tokens", async () => {
    const storage = new InMemoryStorage();
    const user = await storage.createUser({ name: "Ada", email: "ada@example.com" });
    const session = await storage.createSession(user.id);
    expect(await storage.getSessionUser(session.token)).toEqual(user);
    expect(await storage.getSessionUser("nope")).toBeNull();
  });

  it("scopes organizations, repositories and policies by owner/org", async () => {
    const storage = new InMemoryStorage();
    const { user, org } = await seedOrgRepo(storage);
    expect(await storage.listOrganizations(user.id)).toHaveLength(1);
    expect(await storage.listOrganizations("someone-else")).toHaveLength(0);
    expect(await storage.listRepositories(org.id)).toHaveLength(1);

    await storage.createPolicy({
      organizationId: org.id,
      name: "default",
      version: "1.0",
      content: "policies: {}",
      active: true,
    });
    expect(await storage.listPolicies(org.id)).toHaveLength(1);
  });

  it("updates analyses and stores a bundle with its manifest", async () => {
    const storage = new InMemoryStorage();
    const { repo } = await seedOrgRepo(storage);
    const analysis = await storage.createAnalysis({ repositoryId: repo.id, commitSha: "abcdef1" });
    expect(analysis.status).toBe("CREATED");

    const updated = await storage.updateAnalysis(analysis.id, { status: "TESTING" });
    expect(updated.status).toBe("TESTING");
    expect(updated.updatedAt >= analysis.updatedAt).toBe(true);

    const bundle = await storage.createEvidenceBundle({
      analysisId: analysis.id,
      commitSha: "abcdef1",
      manifestVersion: "1.0.0",
      riskScore: 18,
      evidenceHash: "sha256:" + "a".repeat(64),
      manifest: { hello: "world" },
    });
    expect(await storage.getEvidenceBundle(bundle.id)).toEqual(bundle);
    expect(await storage.getManifest(bundle.id)).toEqual({ hello: "world" });
  });

  it("throws when updating a missing analysis", async () => {
    const storage = new InMemoryStorage();
    await expect(storage.updateAnalysis("missing", { status: "FAILED" })).rejects.toThrow();
  });
});
