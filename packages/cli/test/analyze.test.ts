/**
 * `proofforge analyze`.
 *
 * The analyzer itself has its own suite in the Python service. What these cover
 * is the wiring: that a missing analyzer is reported as missing rather than as a
 * repository with nothing to say, and that the path reaches it intact.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { analyze, runAnalyzer, type AnalyzerResult } from "../src/commands/analyze.js";
import { ExitCode } from "../src/exit-codes.js";

const dir = mkdtempSync(join(tmpdir(), "pf-analyze-"));

function runner(result: Partial<AnalyzerResult>): {
  run: (repoPath: string, json: boolean) => AnalyzerResult;
  calls: { repoPath: string; json: boolean }[];
} {
  const calls: { repoPath: string; json: boolean }[] = [];
  return {
    calls,
    run: (repoPath, json) => {
      calls.push({ repoPath, json });
      return { status: "ok", stdout: "summary", detail: "", ...result };
    },
  };
}

describe("running the analyzer", () => {
  it("passes its output through unchanged", () => {
    const { run } = runner({ stdout: "ProofForge Repository Analysis — x\n\n  files: 3\n" });

    const result = analyze(dir, { runner: run });

    expect(result.exitCode).toBe(ExitCode.Success);
    // One place decides what an analysis looks like, and it is not this one.
    expect(result.stdout).toContain("files: 3");
  });

  it("resolves the path before handing it over", () => {
    const { run, calls } = runner({});

    analyze(dir, { runner: run });

    expect(calls[0]?.repoPath).toBe(dir);
  });

  it("asks for JSON only when the caller did", () => {
    const plain = runner({});
    const asJson = runner({});

    analyze(dir, { runner: plain.run });
    analyze(dir, { json: true, runner: asJson.run });

    expect(plain.calls[0]?.json).toBe(false);
    expect(asJson.calls[0]?.json).toBe(true);
  });
});

describe("when the analysis cannot happen", () => {
  it("rejects a path that is not a directory", () => {
    const result = analyze(join(dir, "absent"), { runner: runner({}).run });

    expect(result.exitCode).toBe(ExitCode.UsageError);
    expect(result.stdout).toContain("Not a directory");
  });

  it("does not run the analyzer for a bad path", () => {
    const { run, calls } = runner({});

    analyze(join(dir, "absent"), { runner: run });

    expect(calls).toHaveLength(0);
  });

  it("says the analyzer is missing rather than reporting an empty repository", () => {
    const { run } = runner({
      status: "unavailable",
      stdout: "",
      detail: "uv is not installed",
    });

    const result = analyze(dir, { runner: run });

    // The distinction the whole product is about: nothing looked, so nothing is
    // known — which is not the same as nothing being there.
    expect(result.exitCode).toBe(ExitCode.UsageError);
    expect(result.stdout).toContain("could not be run");
    expect(result.stdout).toContain("uv is not installed");
  });

  it("reports an analyzer that ran and failed", () => {
    const { run } = runner({ status: "failed", stdout: "", detail: "traceback: boom" });

    const result = analyze(dir, { runner: run });

    expect(result.exitCode).toBe(ExitCode.VerificationFailed);
    expect(result.stdout).toContain("traceback: boom");
  });

  it("keeps the two failures apart in JSON as well", () => {
    const unavailable = analyze(dir, {
      json: true,
      runner: runner({ status: "unavailable", detail: "no uv" }).run,
    });
    const failed = analyze(dir, {
      json: true,
      runner: runner({ status: "failed", detail: "boom" }).run,
    });

    expect(JSON.parse(unavailable.stdout)).toMatchObject({ analyzed: false, reason: "no uv" });
    expect(unavailable.exitCode).not.toBe(failed.exitCode);
  });
});


describe("finding the analyzer service", () => {
  it("does not depend on the working directory", () => {
    // The first version passed a path relative to the cwd, so the command only
    // worked from the repository root. Everywhere else it reported that the
    // analyzer had failed, when it had never been found.
    const elsewhere = mkdtempSync(join(tmpdir(), "pf-cwd-"));
    const original = process.cwd();

    process.chdir(elsewhere);
    try {
      const result = runAnalyzer(dir, false);
      // Either it ran, or uv is absent. What it must not be is the "failed"
      // status, which would mean we mistook a missing analyzer for a broken one.
      expect(result.status).not.toBe("failed");
    } finally {
      process.chdir(original);
    }
  });

  it("reports a configured directory that holds no analyzer", () => {
    const empty = mkdtempSync(join(tmpdir(), "pf-noanalyzer-"));
    const previous = process.env.PROOFFORGE_ANALYZER_DIR;

    process.env.PROOFFORGE_ANALYZER_DIR = empty;
    try {
      const result = runAnalyzer(dir, false);

      expect(result.status).toBe("unavailable");
      expect(result.detail).toContain("not found");
    } finally {
      if (previous === undefined) delete process.env.PROOFFORGE_ANALYZER_DIR;
      else process.env.PROOFFORGE_ANALYZER_DIR = previous;
    }
  });
});
