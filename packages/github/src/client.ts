/**
 * The GitHub REST surface ProofForge needs: check runs, pull-request comments and
 * changed files. Behind an interface so the orchestrator can be tested without
 * touching the network.
 */
import type { InstallationTokenProvider, FetchLike } from "./auth.js";
import type { CheckConclusion } from "./checks.js";
import { isProofForgeComment } from "./comment.js";

export interface RepoRef {
  owner: string;
  repo: string;
  installationId: number;
}

export interface CheckRunInput extends RepoRef {
  headSha: string;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: CheckConclusion;
  title: string;
  summary: string;
  detailsUrl?: string;
}

export interface IssueComment {
  id: number;
  body: string | null;
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitHubClient {
  createCheckRun(input: CheckRunInput): Promise<{ id: number }>;
  updateCheckRun(input: CheckRunInput & { checkRunId: number }): Promise<void>;
  listIssueComments(ref: RepoRef, issueNumber: number): Promise<IssueComment[]>;
  createIssueComment(ref: RepoRef, issueNumber: number, body: string): Promise<{ id: number }>;
  updateIssueComment(ref: RepoRef, commentId: number, body: string): Promise<void>;
  listPullRequestFiles(ref: RepoRef, pullNumber: number): Promise<ChangedFile[]>;
}

export interface RestClientOptions {
  tokens: InstallationTokenProvider;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

export class RestGitHubClient implements GitHubClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: RestClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async request<T>(
    installationId: number,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.options.tokens.getToken(installationId);
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "proofforge",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`GitHub ${method} ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private checkRunBody(input: CheckRunInput): Record<string, unknown> {
    return {
      name: input.name,
      head_sha: input.headSha,
      status: input.status,
      ...(input.conclusion ? { conclusion: input.conclusion } : {}),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: { title: input.title, summary: input.summary },
    };
  }

  async createCheckRun(input: CheckRunInput): Promise<{ id: number }> {
    return this.request<{ id: number }>(
      input.installationId,
      "POST",
      `/repos/${input.owner}/${input.repo}/check-runs`,
      this.checkRunBody(input),
    );
  }

  async updateCheckRun(input: CheckRunInput & { checkRunId: number }): Promise<void> {
    await this.request(
      input.installationId,
      "PATCH",
      `/repos/${input.owner}/${input.repo}/check-runs/${input.checkRunId}`,
      this.checkRunBody(input),
    );
  }

  async listIssueComments(ref: RepoRef, issueNumber: number): Promise<IssueComment[]> {
    return this.request<IssueComment[]>(
      ref.installationId,
      "GET",
      `/repos/${ref.owner}/${ref.repo}/issues/${issueNumber}/comments?per_page=100`,
    );
  }

  async createIssueComment(
    ref: RepoRef,
    issueNumber: number,
    body: string,
  ): Promise<{ id: number }> {
    return this.request<{ id: number }>(
      ref.installationId,
      "POST",
      `/repos/${ref.owner}/${ref.repo}/issues/${issueNumber}/comments`,
      { body },
    );
  }

  async updateIssueComment(ref: RepoRef, commentId: number, body: string): Promise<void> {
    await this.request(
      ref.installationId,
      "PATCH",
      `/repos/${ref.owner}/${ref.repo}/issues/comments/${commentId}`,
      { body },
    );
  }

  async listPullRequestFiles(ref: RepoRef, pullNumber: number): Promise<ChangedFile[]> {
    return this.request<ChangedFile[]>(
      ref.installationId,
      "GET",
      `/repos/${ref.owner}/${ref.repo}/pulls/${pullNumber}/files?per_page=100`,
    );
  }
}

/**
 * Post the verification comment, replacing ProofForge's previous one when present
 * so a PR accumulates one comment instead of one per push.
 */
export async function upsertVerificationComment(
  client: GitHubClient,
  ref: RepoRef,
  pullNumber: number,
  body: string,
): Promise<{ id: number; updated: boolean }> {
  const existing = (await client.listIssueComments(ref, pullNumber)).find((comment) =>
    isProofForgeComment(comment.body),
  );

  if (existing) {
    await client.updateIssueComment(ref, existing.id, body);
    return { id: existing.id, updated: true };
  }

  const created = await client.createIssueComment(ref, pullNumber, body);
  return { id: created.id, updated: false };
}
