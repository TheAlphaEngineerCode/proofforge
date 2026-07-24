/**
 * `proofforge evidence build <repo>` — produce a verified proof-manifest for a
 * local repository, end to end.
 *
 * This is the deterministic pipeline the project is built around: the evidence
 * engine (a Python service since Phase 3) runs the collectors and the sandbox,
 * consolidates the results, scores risk and writes a schema-valid
 * `proof-manifest.json`. This command reaches that engine, then **verifies the
 * manifest it produced with the same TypeScript library the CLI ships** — the
 * cross-language check the project has always done by hand, now one command.
 *
 * No AI and no server are involved: `build` is Proof-Carrying Change from the
 * command line. Running an agent task is a different job and belongs to `run`,
 * which stays unavailable until the agents are exercised against a real model.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyManifest } from "@proofforge/evidence-spec";

import { ExitCode } from "../exit-codes.js";
import { readJsonFile } from "../io.js";
import { fail, heading, jsonBlock, pass, safe, warn, type CommandResult } from "../output.js";

/** The change under analysis. Best-effort from git, overridable by the caller. */
export interface BuildContext {
  readonly owner: string;
  readonly name: string;
  readonly url: string;
  readonly commit: string;
  readonly base: string;
  readonly branch: string;
  readonly pr?: number;
  readonly title: string;
}

export interface EvidenceBuildOptions {
  json?: boolean;
  /** Override the base commit the diff is taken against. */
  base?: string;
  /** Where the engine writes the bundle. Made absolute before use. */
  outputDir?: string;
  /** Path to an ed25519 private key (PEM or raw base64) to sign the manifest. */
  signingKey?: string;
  /** Sandbox image digest to record in the manifest. */
  image?: string;
  /** Injected by tests; defaults to reading git for real. */
  git?: GitContextReader;
  /** Injected by tests; defaults to running the engine for real. */
  builder?: EvidenceBuilder;
}

export interface BuilderResult {
  readonly status: "ok" | "unavailable" | "failed";
  /** Absolute path to the manifest the engine wrote, when `ok`. */
  readonly manifestPath: string;
  /** The engine's own summary, echoed on success. */
  readonly stdout: string;
  readonly detail: string;
}

export type EvidenceBuilder = (
  repoPath: string,
  context: BuildContext,
  options: { outputDir: string; signingKey?: string; image?: string },
) => BuilderResult;

export type GitContextReader = (repoPath: string, base?: string) => BuildContext;

export function evidenceBuild(path: string, options: EvidenceBuildOptions = {}): CommandResult {
  const repoPath = resolve(path);

  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    return { exitCode: ExitCode.UsageError, stdout: fail(`Not a directory: ${safe(path)}`) };
  }

  const readGit = options.git ?? readGitContext;
  const build = options.builder ?? runEngine;
  const context = readGit(repoPath, options.base);

  // Absolute so it lands beside the repository regardless of the working
  // directory the engine is spawned in — `uv run --directory` moves cwd, and a
  // relative output path would otherwise be written inside the engine's source.
  const outputDir = resolve(options.outputDir ?? join(repoPath, ".proofforge", "bundle"));

  const built = build(repoPath, context, {
    outputDir,
    signingKey: options.signingKey,
    image: options.image,
  });

  if (built.status === "unavailable") {
    // The engine not running is not the same as a change with nothing to prove,
    // and a caller has to be able to tell the two apart.
    return {
      exitCode: ExitCode.UsageError,
      stdout: options.json
        ? jsonBlock({ built: false, verified: false, reason: built.detail })
        : fail(`The evidence engine could not be run: ${safe(built.detail)}`),
    };
  }

  if (built.status === "failed") {
    return {
      exitCode: ExitCode.VerificationFailed,
      stdout: options.json
        ? jsonBlock({ built: false, verified: false, reason: built.detail })
        : fail(`The evidence engine failed: ${safe(built.detail)}`),
    };
  }

  // The engine wrote a manifest. Verifying it here — rather than trusting the
  // exit code — is the point: a bundle the CLI cannot verify is not evidence,
  // and the engine that wrote it is the last thing that should get to vouch for
  // it. This closes the loop with the same library `evidence verify` uses.
  let result;
  try {
    result = verifyManifest(readJsonFile(built.manifestPath), { requireSignature: false });
  } catch {
    // The engine claimed success but left nothing we can read. That is a bundle
    // that does not verify, and it has to be reported in the caller's chosen
    // format — letting readJsonFile's error escape here would drop to a text
    // message on stderr and break `--json`, the confusion this command exists
    // to avoid.
    const reason = `the engine reported success but its manifest could not be read: ${built.manifestPath}`;
    return {
      exitCode: ExitCode.VerificationFailed,
      stdout: options.json
        ? jsonBlock({ built: true, verified: false, reason })
        : fail(safe(reason)),
    };
  }

  if (options.json) {
    return {
      exitCode: result.valid ? ExitCode.Success : ExitCode.VerificationFailed,
      stdout: jsonBlock({
        built: true,
        verified: result.valid,
        manifest: built.manifestPath,
        hash: result.hash,
        signature: result.signature,
      }),
    };
  }

  const lines: string[] = [];
  if (built.stdout.trim() !== "") {
    // The engine's summary is multi-line by design, but it interpolates
    // repository-derived fields (title, branch, collector details). Neutralize
    // control characters per line so an injected escape cannot reformat the
    // terminal, without collapsing the layout — `safe` alone drops the newlines.
    const echoed = built.stdout.trimEnd().split("\n").map(safe).join("\n");
    lines.push(echoed, "");
  }

  lines.push(heading(`Verifying ${built.manifestPath}`), "");
  lines.push(
    result.structure.valid ? pass("Structure matches schema") : fail("Structure invalid"),
  );
  if (result.hash) {
    lines.push(
      result.hash.valid
        ? pass(`Evidence hash matches (${result.hash.expected})`)
        : fail("Evidence hash mismatch"),
    );
  }
  if (result.signature?.status === "valid") lines.push(pass("Signature valid"));
  else if (result.signature?.status === "invalid") lines.push(fail("Signature invalid"));
  else if (result.signature?.status === "unsigned") lines.push(warn("Manifest is unsigned"));

  lines.push("", result.valid ? pass(heading("VERIFIED")) : fail(heading("FAILED")));

  return {
    exitCode: result.valid ? ExitCode.Success : ExitCode.VerificationFailed,
    stdout: lines.join("\n"),
  };
}

/**
 * Read the change context from git, falling back on anything it cannot answer.
 *
 * A repository without git, or with a single commit, still has a change worth
 * proving; the engine already treats an uncomputable diff as unavailable rather
 * than as an empty one. So every lookup here is best-effort and never fatal.
 */
function readGitContext(repoPath: string, baseOverride?: string): BuildContext {
  const git = (args: string[]): string | null => {
    const result = spawnSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
    if (result.error !== undefined || result.status !== 0) return null;
    return (result.stdout ?? "").trim() || null;
  };

  const commit = git(["rev-parse", "HEAD"]) ?? "0".repeat(40);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD";
  const base = baseOverride ?? git(["rev-parse", "HEAD~1"]) ?? commit;
  const remote = git(["remote", "get-url", "origin"]);
  const { owner, name } = parseRemote(remote, repoPath);

  return {
    owner,
    name,
    url: remote ?? `file://${repoPath}`,
    commit,
    base,
    branch,
    title: `Change on ${branch}`,
  };
}

/**
 * Pull owner/name out of a git remote URL, covering both SSH and HTTPS forms.
 * When it is neither — or there is no remote — the directory name is the best
 * honest guess for the repository, and "local" for the owner.
 */
function parseRemote(
  remote: string | null,
  repoPath: string,
): { owner: string; name: string } {
  const fallback = { owner: "local", name: basename(repoPath) };
  if (remote === null) return fallback;

  // git@host:owner/name.git  and  https://host/owner/name(.git)
  const match = remote.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (match === null || match[1] === undefined || match[2] === undefined) return fallback;
  return { owner: match[1], name: match[2] };
}

/**
 * Run the evidence engine through uv, which owns its virtualenv.
 *
 * String context values are passed as `--flag=value` single tokens so a value
 * that begins with a dash cannot be read as another option by the engine's
 * parser — there is no shell here, so this is argument injection, not shell
 * injection, but the guard is the same.
 */
function runEngine(
  repoPath: string,
  context: BuildContext,
  options: { outputDir: string; signingKey?: string; image?: string },
): BuilderResult {
  const empty: Omit<BuilderResult, "status" | "detail"> = { manifestPath: "", stdout: "" };

  if (!isAbsolute(repoPath) || repoPath.startsWith("-")) {
    return { ...empty, status: "unavailable", detail: "the repository path is not usable" };
  }

  const engineDir = findEngine();
  if (engineDir === null) {
    return {
      ...empty,
      status: "unavailable",
      detail: "the evidence engine service was not found; set PROOFFORGE_EVIDENCE_DIR to its directory",
    };
  }

  const args = [
    "run",
    "--directory",
    engineDir,
    "proofforge-evidence",
    "build",
    `--repo=${repoPath}`,
    `--owner=${context.owner}`,
    `--name=${context.name}`,
    `--url=${context.url}`,
    `--commit=${context.commit}`,
    `--base=${context.base}`,
    `--branch=${context.branch}`,
    `--title=${context.title}`,
    `--output-dir=${options.outputDir}`,
  ];
  if (context.pr !== undefined) args.push(`--pr=${context.pr}`);
  if (options.image !== undefined && options.image !== "") args.push(`--image=${options.image}`);
  if (options.signingKey !== undefined && options.signingKey !== "") {
    args.push(`--signing-key=${resolve(options.signingKey)}`);
  }

  const result = spawnSync("uv", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

  if (result.error !== undefined) {
    const missing = (result.error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ...empty,
      status: "unavailable",
      detail: missing
        ? "uv is not installed, and the evidence engine runs in the Python service"
        : result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      ...empty,
      status: "failed",
      detail: (result.stderr ?? "").trim().slice(0, 500) || `the engine exited ${result.status}`,
    };
  }

  return {
    status: "ok",
    manifestPath: join(options.outputDir, "proof-manifest.json"),
    stdout: result.stdout ?? "",
    detail: "",
  };
}

/**
 * Locate the Python service. Resolving from this module's own location keeps the
 * command working from any working directory; the environment variable covers a
 * layout this cannot guess. Mirrors how `analyze` finds the analyzer.
 */
function findEngine(): string | null {
  const configured = process.env.PROOFFORGE_EVIDENCE_DIR;
  if (configured !== undefined && configured.trim() !== "") {
    return existsSync(join(configured, "pyproject.toml")) ? configured : null;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  for (const up of ["../../..", "../.."]) {
    const candidate = resolve(here, up, "services/evidence-engine");
    if (existsSync(join(candidate, "pyproject.toml"))) return candidate;
  }
  return null;
}

export { runEngine, readGitContext, parseRemote };
