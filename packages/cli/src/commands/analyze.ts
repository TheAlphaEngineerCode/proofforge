/**
 * `proofforge analyze` — run the repository analyzer over a local checkout.
 *
 * The analyzer is a Python service and has been since Phase 2, tested and
 * reachable only by knowing its own entry point. This runs it, so the command
 * the CLI has always advertised does the thing it says.
 *
 * It reads a repository and never executes it: the analyzer works from manifests
 * and file structure. Running the repository's code is the evidence engine's job,
 * and that happens in a container.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { ExitCode } from "../exit-codes.js";
import { fail, jsonBlock, safe, type CommandResult } from "../output.js";

export interface AnalyzeOptions {
  json?: boolean;
  /** Injected by tests; defaults to running the analyzer for real. */
  runner?: AnalyzerRunner;
}

export interface AnalyzerResult {
  readonly status: "ok" | "unavailable" | "failed";
  readonly stdout: string;
  readonly detail: string;
}

export type AnalyzerRunner = (repoPath: string, json: boolean) => AnalyzerResult;

export function analyze(path: string, options: AnalyzeOptions = {}): CommandResult {
  const repoPath = resolve(path);

  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    return {
      exitCode: ExitCode.UsageError,
      stdout: fail(`Not a directory: ${safe(path)}`),
    };
  }

  const json = options.json === true;
  const run = options.runner ?? runAnalyzer;
  const result = run(repoPath, json);

  if (result.status === "unavailable") {
    // Saying the analyzer is missing is not the same as saying the repository
    // has nothing worth reporting, and a caller has to be able to tell.
    return {
      exitCode: ExitCode.UsageError,
      stdout: options.json
        ? jsonBlock({ analyzed: false, reason: result.detail })
        : fail(`The analyzer could not be run: ${safe(result.detail)}`),
    };
  }

  if (result.status === "failed") {
    return {
      exitCode: ExitCode.VerificationFailed,
      stdout: options.json
        ? jsonBlock({ analyzed: false, reason: result.detail })
        : fail(`The analyzer failed: ${safe(result.detail)}`),
    };
  }

  // The analyzer writes both shapes itself, so pass its output through rather
  // than reformatting: one place decides what an analysis looks like.
  return { exitCode: ExitCode.Success, stdout: result.stdout.trimEnd() };
}

/**
 * Run the analyzer through uv, which owns its virtualenv.
 *
 * The path is passed after `--` and checked for a leading dash first. There is
 * no shell here, so this is not shell injection — it is argument injection: a
 * path beginning with a dash reads as an option to whatever receives it.
 */
function runAnalyzer(repoPath: string, json: boolean): AnalyzerResult {
  if (!isAbsolute(repoPath) || repoPath.startsWith("-")) {
    return { status: "unavailable", stdout: "", detail: "the repository path is not usable" };
  }

  const args = ["run", "--directory", "services/repository-analyzer", "proofforge-analyzer"];
  if (json) args.push("--json");
  // The path goes after `--` so a name that begins with a dash cannot be read
  // as an option by the analyzer's own parser.
  args.push("--", repoPath);

  const result = spawnSync("uv", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    const missing = (result.error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      status: "unavailable",
      stdout: "",
      detail: missing
        ? "uv is not installed, and the analyzer runs in the Python service"
        : result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      status: "failed",
      stdout: result.stdout ?? "",
      detail: (result.stderr ?? "").trim().slice(0, 500) || `the analyzer exited ${result.status}`,
    };
  }

  return { status: "ok", stdout: result.stdout ?? "", detail: "" };
}

export { runAnalyzer };
