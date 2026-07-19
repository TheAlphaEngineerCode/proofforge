/**
 * Getting the code onto disk so evidence can be collected from it.
 *
 * A shallow clone pinned to the exact commit under analysis: evidence is bound to
 * a commit, so the checkout must be too. Private repositories are fetched with the
 * installation token, which is injected per call and never written to disk or into
 * the remote URL stored in git config.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface CheckoutRequest {
  owner: string;
  repo: string;
  commitSha: string;
  /** Installation token for private repositories; omitted for public ones. */
  token?: string;
}

export interface Checkout {
  path: string;
  dispose(): Promise<void>;
}

export interface RepositoryCheckout {
  fetch(request: CheckoutRequest): Promise<Checkout>;
}

export interface GitCheckoutOptions {
  /** Guards against a hung clone on a huge or unreachable repository. */
  timeoutMs?: number;
  gitHost?: string;
}

export class GitRepositoryCheckout implements RepositoryCheckout {
  private readonly timeoutMs: number;
  private readonly gitHost: string;

  constructor(options: GitCheckoutOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.gitHost = options.gitHost ?? "github.com";
  }

  async fetch(request: CheckoutRequest): Promise<Checkout> {
    const dir = await mkdtemp(join(tmpdir(), "proofforge-src-"));
    const dispose = async (): Promise<void> => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    };

    // The token lives only in this argument vector, never in git config or logs.
    const credentials = request.token ? `x-access-token:${request.token}@` : "";
    const remote = `https://${credentials}${this.gitHost}/${request.owner}/${request.repo}.git`;

    try {
      await this.git(dir, ["init", "--quiet"]);
      await this.git(dir, ["remote", "add", "origin", remote]);
      await this.git(dir, ["fetch", "--depth", "1", "--quiet", "origin", request.commitSha]);
      await this.git(dir, ["checkout", "--quiet", "FETCH_HEAD"]);
      // Drop the remote so the token cannot linger in the working copy's config.
      await this.git(dir, ["remote", "remove", "origin"]);
    } catch (err) {
      await dispose();
      throw new Error(`checkout of ${request.owner}/${request.repo} failed: ${describe(err)}`);
    }

    return { path: dir, dispose };
  }

  private async git(cwd: string, args: string[]): Promise<void> {
    await run("git", args, { cwd, timeout: this.timeoutMs, windowsHide: true });
  }
}

/** Keep a token out of any error surfaced to logs or the API response. */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}
