import { InMemoryStorage } from "@proofforge/database";
import type { ChangedFile, GitHubClient, IssueComment, RepoRef } from "@proofforge/github";
import { describe, expect, it } from "vitest";
import { buildAnalysisManifest } from "../src/manifest.js";
import { GitHubPublisher, type PublishTarget } from "../src/services/github-publisher.js";

class FakeGitHubClient implements GitHubClient {
  checkRuns: string[] = [];
  created: string[] = [];
  updated: string[] = [];
  existingComments: IssueComment[] = [];

  async createCheckRun(input: { title: string }): Promise<{ id: number }> {
    this.checkRuns.push(input.title);
    return { id: this.checkRuns.length };
  }

  async updateCheckRun(): Promise<void> {}

  async listIssueComments(_ref: RepoRef, _issue: number): Promise<IssueComment[]> {
    return this.existingComments;
  }

  async createIssueComment(_ref: RepoRef, _issue: number, body: string): Promise<{ id: number }> {
    this.created.push(body);
    return { id: 1 };
  }

  async updateIssueComment(_ref: RepoRef, _id: number, body: string): Promise<void> {
    this.updated.push(body);
  }

  async listPullRequestFiles(): Promise<ChangedFile[]> {
    return [];
  }
}

async function seedAnalysisWithManifest(storage: InMemoryStorage): Promise<string> {
  const user = await storage.createUser({ name: "u", email: "u@example.com" });
  const org = await storage.createOrganization({ name: "o", slug: "o", ownerId: user.id });
  const repo = await storage.createRepository({
    organizationId: org.id,
    owner: "acme",
    name: "api",
    defaultBranch: "main",
    language: null,
    private: false,
  });
  const analysis = await storage.createAnalysis({ repositoryId: repo.id, commitSha: "c".repeat(40) });
  const manifest = buildAnalysisManifest({
    id: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
    owner: "acme",
    name: "api",
    commit: "c".repeat(40),
    baseCommit: "c".repeat(40),
    branch: "main",
    riskScore: 18,
    riskLevel: "low",
  });
  const bundle = await storage.createEvidenceBundle({
    analysisId: analysis.id,
    commitSha: "c".repeat(40),
    manifestVersion: manifest.specVersion,
    riskScore: 18,
    evidenceHash: manifest.evidenceHash,
    manifest,
  });
  await storage.updateAnalysis(analysis.id, { evidenceBundleId: bundle.id });
  return analysis.id;
}

const target = (extra: Partial<PublishTarget> = {}): PublishTarget => ({
  owner: "acme",
  repo: "api",
  installationId: 987,
  headSha: "c".repeat(40),
  ...extra,
});

describe("GitHubPublisher", () => {
  it("publishes a check run and a comment for a pull request", async () => {
    const storage = new InMemoryStorage();
    const analysisId = await seedAnalysisWithManifest(storage);
    const client = new FakeGitHubClient();

    await new GitHubPublisher(storage, client, { warn: () => {} }).publish(
      target({ pullRequest: 42 }),
      analysisId,
    );

    expect(client.checkRuns).toHaveLength(1);
    expect(client.created).toHaveLength(1);
    expect(client.created[0]).toContain("ProofForge");
  });

  it("publishes only the check run for a push, which has no pull request", async () => {
    const storage = new InMemoryStorage();
    const analysisId = await seedAnalysisWithManifest(storage);
    const client = new FakeGitHubClient();

    await new GitHubPublisher(storage, client, { warn: () => {} }).publish(target(), analysisId);

    expect(client.checkRuns).toHaveLength(1);
    expect(client.created).toHaveLength(0);
  });

  it("adds the comment without a second check run when one already exists", async () => {
    // A push and a pull_request event arrive for the same commit; the push wins
    // and publishes the check run, so the pull_request event must only comment.
    const storage = new InMemoryStorage();
    const analysisId = await seedAnalysisWithManifest(storage);
    const client = new FakeGitHubClient();

    await new GitHubPublisher(storage, client, { warn: () => {} }).publish(
      target({ pullRequest: 42, commentOnly: true }),
      analysisId,
    );

    expect(client.checkRuns).toHaveLength(0);
    expect(client.created).toHaveLength(1);
  });

  it("updates the existing comment instead of stacking a new one", async () => {
    const storage = new InMemoryStorage();
    const analysisId = await seedAnalysisWithManifest(storage);
    const client = new FakeGitHubClient();
    client.existingComments = [{ id: 55, body: "<!-- proofforge:verification -->\nold" }];

    await new GitHubPublisher(storage, client, { warn: () => {} }).publish(
      target({ pullRequest: 42 }),
      analysisId,
    );

    expect(client.created).toHaveLength(0);
    expect(client.updated).toHaveLength(1);
  });
});
