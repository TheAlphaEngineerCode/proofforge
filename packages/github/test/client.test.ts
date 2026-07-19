import { describe, expect, it } from "vitest";
import { upsertVerificationComment, type ChangedFile, type GitHubClient, type IssueComment, type RepoRef } from "../src/client.js";
import { COMMENT_MARKER } from "../src/comment.js";

const REF: RepoRef = { owner: "acme", repo: "api", installationId: 987 };

class FakeClient implements GitHubClient {
  created: string[] = [];
  updated: Array<{ id: number; body: string }> = [];

  constructor(private comments: IssueComment[] = []) {}

  async createCheckRun(): Promise<{ id: number }> {
    return { id: 1 };
  }
  async updateCheckRun(): Promise<void> {}
  async listIssueComments(): Promise<IssueComment[]> {
    return this.comments;
  }
  async createIssueComment(_ref: RepoRef, _issue: number, body: string): Promise<{ id: number }> {
    this.created.push(body);
    return { id: 100 + this.created.length };
  }
  async updateIssueComment(_ref: RepoRef, commentId: number, body: string): Promise<void> {
    this.updated.push({ id: commentId, body });
  }
  async listPullRequestFiles(): Promise<ChangedFile[]> {
    return [];
  }
}

describe("upsertVerificationComment", () => {
  it("creates a comment when the PR has none from ProofForge", async () => {
    const client = new FakeClient([{ id: 7, body: "unrelated review comment" }]);

    const result = await upsertVerificationComment(client, REF, 42, `${COMMENT_MARKER}\nbody`);

    expect(result).toEqual({ id: 101, updated: false });
    expect(client.created).toHaveLength(1);
    expect(client.updated).toHaveLength(0);
  });

  it("updates the existing ProofForge comment instead of adding another", async () => {
    const client = new FakeClient([
      { id: 7, body: "unrelated" },
      { id: 9, body: `${COMMENT_MARKER}\nprevious run` },
    ]);

    const result = await upsertVerificationComment(client, REF, 42, `${COMMENT_MARKER}\nnew run`);

    expect(result).toEqual({ id: 9, updated: true });
    expect(client.updated).toEqual([{ id: 9, body: `${COMMENT_MARKER}\nnew run` }]);
    expect(client.created).toHaveLength(0);
  });

  it("ignores comments with a null body", async () => {
    const client = new FakeClient([{ id: 7, body: null }]);
    const result = await upsertVerificationComment(client, REF, 42, "body");
    expect(result.updated).toBe(false);
  });
});
