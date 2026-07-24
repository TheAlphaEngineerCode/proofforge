/**
 * GitHub App webhook receiver.
 *
 * Registered in its own encapsulated scope with a raw-body parser: the signature
 * covers the exact bytes GitHub sent, so verification must happen before the JSON
 * is parsed. An unverified delivery never reaches the routing logic.
 *
 * Deliveries are always answered 2xx once authenticated — including events we
 * deliberately ignore — so GitHub does not retry them indefinitely. Only a failed
 * signature check returns 401.
 */
import type { FastifyInstance } from "fastify";
import { parseWebhook, verifyWebhookSignature } from "@proofforge/github";
import { isTerminal } from "@proofforge/shared-types";
import type { AppDeps } from "../deps.js";
import type { GitHubPublisher, PublishTarget } from "../services/github-publisher.js";

interface WebhookHeaders {
  "x-hub-signature-256"?: string;
  "x-github-event"?: string;
  "x-github-delivery"?: string;
}

export async function githubWebhookRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(async (scope) => {
    // Keep the body as raw bytes; this parser is scoped to these routes only.
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scope.post("/api/v1/github/webhook", async (request, reply) => {
      const headers = request.headers as WebhookHeaders;
      const secret = deps.config.githubWebhookSecret;

      if (secret === "") {
        void reply.status(503);
        return { error: "github webhook is not configured" };
      }

      // A delivery that did not arrive as raw JSON bytes cannot be authenticated.
      const rawBody = request.body;
      if (!Buffer.isBuffer(rawBody)) {
        void reply.status(400);
        return { error: "expected a raw application/json body" };
      }

      if (!verifyWebhookSignature(rawBody, headers["x-hub-signature-256"], secret)) {
        request.log.warn(
          { delivery: headers["x-github-delivery"] },
          "[github] rejected webhook with an invalid signature",
        );
        void reply.status(401);
        return { error: "invalid signature" };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        void reply.status(400);
        return { error: "invalid JSON payload" };
      }

      const parsed = parseWebhook(headers["x-github-event"] ?? "", payload);

      switch (parsed.type) {
        case "installation": {
          const { installationId, account, action } = parsed.change;
          if (action === "deleted") {
            await deps.storage.deleteInstallation(installationId);
          } else {
            await deps.storage.upsertInstallation({
              githubInstallationId: installationId,
              accountLogin: account,
              suspended: action === "suspend",
            });
          }
          void reply.status(202);
          return { status: "installation_recorded", action };
        }

        case "pull_request": {
          const { target } = parsed;
          const result = await startAnalysis(deps, {
            owner: target.owner,
            repo: target.repo,
            headSha: target.headSha,
            installationId: target.installationId,
            pullRequest: target.pullRequest,
          });
          void reply.status(202);
          return result;
        }

        case "push": {
          const { target } = parsed;
          const result = await startAnalysis(deps, {
            owner: target.owner,
            repo: target.repo,
            headSha: target.headSha,
            installationId: target.installationId,
          });
          void reply.status(202);
          return result;
        }

        default:
          void reply.status(202);
          return { status: "ignored", reason: parsed.reason };
      }
    });
  });
}

interface StartAnalysisInput {
  owner: string;
  repo: string;
  headSha: string;
  installationId: number | null;
  pullRequest?: number;
}

/**
 * Start an analysis for a webhook target, if that repository is connected to
 * ProofForge. Publishing back to GitHub happens once the pipeline finishes.
 */
async function startAnalysis(
  deps: AppDeps,
  input: StartAnalysisInput,
): Promise<{ status: string; analysisId?: string; reason?: string }> {
  const repository = await deps.storage.findRepositoryByFullName(input.owner, input.repo);
  if (!repository) {
    return { status: "ignored", reason: "repository is not connected to ProofForge" };
  }

  const publisher = deps.publisher;
  const installationId = input.installationId;

  // GitHub redelivers webhooks, and evidence is bound to a commit — so the same
  // commit must never spawn a second analysis. Reuse the existing one instead.
  const existing = (await deps.storage.listAnalyses(repository.id)).find(
    (candidate) => candidate.commitSha === input.headSha,
  );
  if (existing) {
    // Pushing to a pull request fires `push` (no PR number) and `pull_request`
    // for the same commit, and the push usually wins the race. Skipping the
    // second event entirely would mean the pull request never gets its comment,
    // so publish it here — the check run already exists, so only comment.
    if (publisher && installationId !== null && input.pullRequest !== undefined) {
      const target: PublishTarget = {
        owner: input.owner,
        repo: input.repo,
        installationId,
        headSha: input.headSha,
        pullRequest: input.pullRequest,
        commentOnly: true,
      };
      publishOnSettle(deps, publisher, existing.id, target);
    }
    return { status: "already_analyzed", analysisId: existing.id };
  }

  const analysis = await deps.storage.createAnalysis({
    repositoryId: repository.id,
    commitSha: input.headSha,
  });

  // The publish target travels with the job: whoever runs the analysis — this
  // process or a worker off Redis — reports the result when the run finishes.
  const target: PublishTarget | undefined =
    publisher && installationId !== null
      ? {
          owner: input.owner,
          repo: input.repo,
          installationId,
          headSha: input.headSha,
          ...(input.pullRequest === undefined ? {} : { pullRequest: input.pullRequest }),
        }
      : undefined;

  void deps.queue
    .enqueue({
      analysisId: analysis.id,
      ...(target === undefined ? {} : { publish: target }),
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[github] failed to enqueue analysis ${analysis.id}: ${message}`);
    });

  return { status: "analysis_started", analysisId: analysis.id };
}

/**
 * Publish a pull-request comment once the analysis it belongs to has settled.
 *
 * The already-analysed re-delivery cannot travel with the run — the run may
 * already be underway in a worker — so it waits for the completion event, which
 * reaches this process whether the run happened here or was bridged from a
 * worker over Redis. The analysis record is the backstop for a run that finished
 * before we subscribed, and a timeout keeps a lost run from holding the
 * subscription forever. Whichever fires first, the publish happens once.
 */
function publishOnSettle(
  deps: AppDeps,
  publisher: GitHubPublisher,
  analysisId: string,
  target: PublishTarget,
): void {
  let settled = false;
  let unsubscribe: () => void = () => {};

  const timer = setTimeout(() => {
    settled = true;
    unsubscribe();
  }, 300_000);
  timer.unref();

  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    unsubscribe();
    void publisher.publish(target, analysisId).catch(() => {});
  };

  unsubscribe = deps.events.subscribe(analysisId, (event) => {
    if (event.type === "completed" || event.type === "error") finish();
  });

  void deps.storage.getAnalysis(analysisId).then((current) => {
    if (current && isTerminal(current.status)) finish();
  });
}
