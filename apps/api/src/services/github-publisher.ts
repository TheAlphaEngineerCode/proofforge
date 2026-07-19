/**
 * Publishes an analysis result back to GitHub: a Check Run on the commit and,
 * for pull requests, a verification comment that is updated in place on re-runs.
 *
 * Publishing is best-effort — a GitHub outage must not fail the analysis that
 * already produced valid evidence, so failures are logged and swallowed.
 */
import type { Manifest } from "@proofforge/evidence-spec";
import type { Storage } from "@proofforge/database";
import {
  mapManifestToCheckRun,
  renderPullRequestComment,
  upsertVerificationComment,
  type GitHubClient,
  type RepoRef,
} from "@proofforge/github";

export interface PublishTarget extends RepoRef {
  headSha: string;
  /** Present for pull requests; absent for plain pushes. */
  pullRequest?: number;
}

export interface Logger {
  warn(message: string): void;
}

export class GitHubPublisher {
  constructor(
    private readonly storage: Storage,
    private readonly client: GitHubClient,
    private readonly logger: Logger,
  ) {}

  async publish(target: PublishTarget, analysisId: string): Promise<void> {
    try {
      const manifest = await this.loadManifest(analysisId);
      if (!manifest) {
        this.logger.warn(`[github] analysis ${analysisId} produced no manifest; nothing to publish`);
        return;
      }

      const check = mapManifestToCheckRun(manifest);
      await this.client.createCheckRun({
        owner: target.owner,
        repo: target.repo,
        installationId: target.installationId,
        headSha: target.headSha,
        name: "ProofForge",
        status: "completed",
        conclusion: check.conclusion,
        title: check.title,
        summary: check.summary,
      });

      if (target.pullRequest !== undefined) {
        await upsertVerificationComment(
          this.client,
          target,
          target.pullRequest,
          renderPullRequestComment(manifest),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[github] failed to publish result for ${analysisId}: ${message}`);
    }
  }

  private async loadManifest(analysisId: string): Promise<Manifest | null> {
    const analysis = await this.storage.getAnalysis(analysisId);
    if (!analysis?.evidenceBundleId) return null;
    const manifest = await this.storage.getManifest(analysis.evidenceBundleId);
    return (manifest as Manifest | null) ?? null;
  }
}
