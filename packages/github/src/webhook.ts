/**
 * Webhook receipt: signature verification and event normalization.
 *
 * Every delivery is authenticated before its payload is trusted. GitHub signs the
 * raw request body with the app's webhook secret (HMAC-SHA256, `X-Hub-Signature-256`),
 * so verification must run against the *raw* bytes — not a re-serialized object.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SIGNATURE_PREFIX = "sha256=";

/**
 * Verify a delivery signature in constant time.
 * Returns false for any malformed or missing signature rather than throwing.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX) || secret === "") {
    return false;
  }

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = Buffer.from(
    SIGNATURE_PREFIX + createHmac("sha256", secret).update(body).digest("hex"),
    "utf8",
  );
  const received = Buffer.from(signatureHeader, "utf8");

  // timingSafeEqual throws on length mismatch, which itself is not secret.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

// ── payload schemas ─────────────────────────────────────────────────────────

const RepositorySchema = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
  default_branch: z.string().optional(),
  private: z.boolean().optional(),
});

const InstallationSchema = z.object({ id: z.number().int() });

const PullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int(),
  pull_request: z.object({
    number: z.number().int(),
    draft: z.boolean().optional(),
    title: z.string().optional(),
    head: z.object({ sha: z.string(), ref: z.string() }),
    base: z.object({ sha: z.string(), ref: z.string() }),
  }),
  repository: RepositorySchema,
  installation: InstallationSchema.optional(),
});

const PushEventSchema = z.object({
  ref: z.string(),
  after: z.string(),
  before: z.string(),
  repository: RepositorySchema,
  installation: InstallationSchema.optional(),
});

const InstallationEventSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number().int(),
    account: z.object({ login: z.string() }).optional(),
  }),
  // Who pressed Install. GitHub sends this on every delivery, and on this one it
  // is the only thing that ties an installation to a person — see
  // {@link InstallationChange.installedBy}.
  sender: z.object({ id: z.number().int() }).optional(),
});

// ── normalized results ──────────────────────────────────────────────────────

export interface PullRequestTarget {
  installationId: number | null;
  owner: string;
  repo: string;
  pullRequest: number;
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
  title: string;
}

export interface PushTarget {
  installationId: number | null;
  owner: string;
  repo: string;
  ref: string;
  headSha: string;
  baseSha: string;
}

export interface InstallationChange {
  installationId: number;
  account: string | null;
  action: string;
  /**
   * The numeric id of the GitHub user who installed the App, as a string.
   *
   * This is the only unforgeable link between an installation and a person. It
   * arrives inside a body GitHub signed, so a caller cannot assert it about
   * themselves — which is what makes it usable as proof when someone later
   * claims the installation for an organization.
   */
  installedBy: string | null;
}

export type ParsedWebhook =
  | { type: "pull_request"; target: PullRequestTarget }
  | { type: "push"; target: PushTarget }
  | { type: "installation"; change: InstallationChange }
  | { type: "ignored"; reason: string };

/** Pull-request actions worth analyzing. Other actions (labeled, closed, …) are noise. */
const ANALYZABLE_PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

/**
 * Normalize a delivery into something the orchestrator can act on.
 * Unknown events and uninteresting actions resolve to `ignored` with a reason —
 * webhooks must always be answered 2xx so GitHub does not retry them forever.
 */
export function parseWebhook(eventName: string, payload: unknown): ParsedWebhook {
  switch (eventName) {
    case "pull_request": {
      const parsed = PullRequestEventSchema.safeParse(payload);
      if (!parsed.success) return { type: "ignored", reason: "malformed pull_request payload" };
      const event = parsed.data;

      if (!ANALYZABLE_PR_ACTIONS.has(event.action)) {
        return { type: "ignored", reason: `pull_request action '${event.action}'` };
      }
      // Draft PRs are skipped until they are marked ready for review.
      if (event.pull_request.draft === true && event.action !== "ready_for_review") {
        return { type: "ignored", reason: "draft pull request" };
      }

      return {
        type: "pull_request",
        target: {
          installationId: event.installation?.id ?? null,
          owner: event.repository.owner.login,
          repo: event.repository.name,
          pullRequest: event.pull_request.number,
          headSha: event.pull_request.head.sha,
          baseSha: event.pull_request.base.sha,
          headRef: event.pull_request.head.ref,
          baseRef: event.pull_request.base.ref,
          title: event.pull_request.title ?? `PR #${event.pull_request.number}`,
        },
      };
    }

    case "push": {
      const parsed = PushEventSchema.safeParse(payload);
      if (!parsed.success) return { type: "ignored", reason: "malformed push payload" };
      const event = parsed.data;

      // Branch deletions push the zero SHA; there is nothing to analyze.
      if (/^0+$/.test(event.after)) return { type: "ignored", reason: "branch deleted" };

      return {
        type: "push",
        target: {
          installationId: event.installation?.id ?? null,
          owner: event.repository.owner.login,
          repo: event.repository.name,
          ref: event.ref,
          headSha: event.after,
          baseSha: event.before,
        },
      };
    }

    case "installation":
    case "installation_repositories": {
      const parsed = InstallationEventSchema.safeParse(payload);
      if (!parsed.success) return { type: "ignored", reason: "malformed installation payload" };
      return {
        type: "installation",
        change: {
          installationId: parsed.data.installation.id,
          account: parsed.data.installation.account?.login ?? null,
          action: parsed.data.action,
          installedBy:
            parsed.data.sender === undefined ? null : String(parsed.data.sender.id),
        },
      };
    }

    default:
      return { type: "ignored", reason: `unsupported event '${eventName}'` };
  }
}
