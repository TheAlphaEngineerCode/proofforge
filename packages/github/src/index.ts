/**
 * @proofforge/github — GitHub App integration.
 *
 * Webhook authentication and normalization, app/installation auth, the OAuth
 * flow that signs people in, the REST surface ProofForge uses, and the rendering
 * of verdicts into Check Runs and pull-request comments.
 */
export {
  verifyWebhookSignature,
  parseWebhook,
  type ParsedWebhook,
  type PullRequestTarget,
  type PushTarget,
  type InstallationChange,
} from "./webhook.js";

export {
  createAppJwt,
  InstallationTokenProvider,
  type AppAuthOptions,
  type InstallationToken,
  type FetchLike,
} from "./auth.js";

export {
  createState,
  verifyState,
  bindingMatches,
  authorizeUrl,
  exchangeCodeForToken,
  fetchIdentity,
  DEFAULT_SCOPES,
  GITHUB_OAUTH_BASE_URL,
  STATE_TTL_MS,
  type StatePayload,
  type AuthorizeUrlOptions,
  type ExchangeOptions,
  type GitHubIdentity,
  type IdentityOptions,
} from "./oauth.js";

export {
  RestGitHubClient,
  upsertVerificationComment,
  type GitHubClient,
  type RepoRef,
  type CheckRunInput,
  type IssueComment,
  type ChangedFile,
  type RestClientOptions,
} from "./client.js";

export {
  evaluateManifest,
  mapManifestToCheckRun,
  type CheckConclusion,
  type CheckRunResult,
  type Verdict,
} from "./checks.js";

export {
  renderPullRequestComment,
  isProofForgeComment,
  COMMENT_MARKER,
} from "./comment.js";
