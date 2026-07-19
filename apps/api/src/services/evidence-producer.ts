/**
 * Producing the evidence bundle for an analysis.
 *
 * The real producer shells out to the Python evidence engine, which runs the
 * collectors and writes a `proof-manifest.json`. The manifest is re-validated
 * against the shared schema before we trust it — a subprocess is an untrusted
 * boundary like any other.
 *
 * When the engine is unavailable the orchestrator falls back to a clearly
 * labelled simulated manifest rather than failing the analysis outright.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ManifestSchema, type Manifest } from "@proofforge/evidence-spec";

const run = promisify(execFile);

export interface EvidenceRequest {
  repoPath: string;
  owner: string;
  name: string;
  commitSha: string;
  baseSha: string;
  branch: string;
  pullRequest?: number;
}

export interface EvidenceProducer {
  /** Returns null when this producer cannot handle the request. */
  produce(request: EvidenceRequest): Promise<Manifest | null>;
}

export interface PythonEvidenceOptions {
  /** Directory of services/evidence-engine (where `uv run` is executed). */
  engineDir: string;
  timeoutMs?: number;
  uvBin?: string;
}

export class PythonEvidenceProducer implements EvidenceProducer {
  private readonly timeoutMs: number;
  private readonly uvBin: string;

  constructor(private readonly options: PythonEvidenceOptions) {
    this.timeoutMs = options.timeoutMs ?? 600_000;
    this.uvBin = options.uvBin ?? "uv";
  }

  async produce(request: EvidenceRequest): Promise<Manifest | null> {
    const bundleDir = join(request.repoPath, ".proofforge-bundle");

    const args = [
      "run",
      "proofforge-evidence",
      "build",
      "--repo",
      request.repoPath,
      "--owner",
      request.owner,
      "--name",
      request.name,
      "--url",
      `https://github.com/${request.owner}/${request.name}`,
      "--commit",
      request.commitSha,
      "--base",
      request.baseSha,
      "--branch",
      request.branch,
      "--output-dir",
      bundleDir,
    ];
    if (request.pullRequest !== undefined) {
      args.push("--pr", String(request.pullRequest));
    }

    await run(this.uvBin, args, {
      cwd: this.options.engineDir,
      timeout: this.timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });

    const raw = await readFile(join(bundleDir, "proof-manifest.json"), "utf8");
    // Validate before trusting: the engine is a separate process and could drift.
    return ManifestSchema.parse(JSON.parse(raw));
  }
}
