/**
 * `proofforge evidence build`.
 *
 * The engine has its own suite in the Python service, and the hash/verify logic
 * has one in evidence-spec. What these cover is the wiring: that a missing engine
 * reads as missing rather than as a change with nothing to prove, that the
 * manifest the engine writes is actually verified before the command claims
 * success, and that a bundle which fails verification fails the command even
 * though the engine exited zero.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "@proofforge/test-fixtures";

import {
  evidenceBuild,
  runEngine,
  parseRemote,
  type BuildContext,
  type BuilderResult,
} from "../src/commands/evidence-build.js";
import { ExitCode } from "../src/exit-codes.js";

const dir = mkdtempSync(join(tmpdir(), "pf-build-"));

const context: BuildContext = {
  owner: "acme",
  name: "widget",
  url: "https://github.com/acme/widget",
  commit: "a".repeat(40),
  base: "b".repeat(40),
  branch: "main",
  title: "Change on main",
};

const git = (): BuildContext => context;

/** Write a manifest to a fresh file and return its path. */
function writeManifest(manifest: unknown, prefix: string): string {
  const path = join(mkdtempSync(join(tmpdir(), prefix)), "proof-manifest.json");
  writeFileSync(path, JSON.stringify(manifest), "utf8");
  return path;
}

/** A valid, hash-correct manifest on disk. */
function writeValidManifest(): string {
  return writeManifest(buildManifest(), "pf-bundle-");
}

function builder(result: Partial<BuilderResult>): {
  build: EvidenceBuilderStub;
  calls: { repoPath: string; context: BuildContext }[];
} {
  const calls: { repoPath: string; context: BuildContext }[] = [];
  return {
    calls,
    build: (repoPath, ctx) => {
      calls.push({ repoPath, context: ctx });
      return { status: "ok", manifestPath: "", stdout: "engine summary", detail: "", ...result };
    },
  };
}

type EvidenceBuilderStub = (repoPath: string, ctx: BuildContext) => BuilderResult;

describe("building an evidence bundle", () => {
  it("verifies the manifest the engine produced and passes", () => {
    const { build } = builder({
      manifestPath: writeValidManifest(),
      stdout: "line one\nline two",
    });

    const result = evidenceBuild(dir, { git, builder: build });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.stdout).toContain("VERIFIED");
    // The engine's summary is echoed above the verdict, and its multi-line
    // layout survives — control-character neutralization must not flatten it.
    expect(result.stdout).toContain("line one\nline two");
  });

  it("fails when the engine's manifest does not verify, despite a clean build", () => {
    // Tamper with a field after the hash was computed: the stored evidenceHash
    // no longer matches the content, so verification must reject it.
    const manifest = buildManifest();
    manifest.tests.passed += 1;
    const { build } = builder({ manifestPath: writeManifest(manifest, "pf-bad-") });

    const result = evidenceBuild(dir, { git, builder: build });

    // A bundle the CLI cannot verify is not evidence, whatever the engine's exit
    // code said.
    expect(result.exitCode).toBe(ExitCode.VerificationFailed);
    expect(result.stdout).toContain("FAILED");
  });

  it("reports JSON with both build and verify outcomes", () => {
    const { build } = builder({ manifestPath: writeValidManifest() });

    const result = evidenceBuild(dir, { json: true, git, builder: build });

    expect(JSON.parse(result.stdout)).toMatchObject({ built: true, verified: true });
  });
});

describe("when the bundle cannot be built", () => {
  it("rejects a path that is not a directory", () => {
    const result = evidenceBuild(join(dir, "absent"), { git, builder: builder({}).build });

    expect(result.exitCode).toBe(ExitCode.UsageError);
    expect(result.stdout).toContain("Not a directory");
  });

  it("says the engine is missing rather than reporting an empty change", () => {
    const { build } = builder({
      status: "unavailable",
      detail: "uv is not installed",
    });

    const result = evidenceBuild(dir, { git, builder: build });

    // Nothing ran, so nothing is known — not the same as nothing being there.
    expect(result.exitCode).toBe(ExitCode.UsageError);
    expect(result.stdout).toContain("could not be run");
    expect(result.stdout).toContain("uv is not installed");
  });

  it("reports an engine that ran and failed", () => {
    const { build } = builder({ status: "failed", detail: "traceback: boom" });

    const result = evidenceBuild(dir, { git, builder: build });

    expect(result.exitCode).toBe(ExitCode.VerificationFailed);
    expect(result.stdout).toContain("traceback: boom");
  });

  it("keeps 'engine missing' and 'engine failed' apart in JSON", () => {
    const unavailable = evidenceBuild(dir, {
      json: true,
      git,
      builder: builder({ status: "unavailable", detail: "no uv" }).build,
    });
    const failed = evidenceBuild(dir, {
      json: true,
      git,
      builder: builder({ status: "failed", detail: "boom" }).build,
    });

    expect(JSON.parse(unavailable.stdout)).toMatchObject({ built: false, reason: "no uv" });
    expect(unavailable.exitCode).not.toBe(failed.exitCode);
  });
});

describe("the change context handed to the engine", () => {
  it("passes the resolved repository path and the git context through", () => {
    const { build, calls } = builder({ manifestPath: writeValidManifest() });

    evidenceBuild(dir, { git, builder: build });

    expect(calls[0]?.repoPath).toBe(dir);
    expect(calls[0]?.context.owner).toBe("acme");
    expect(calls[0]?.context.branch).toBe("main");
  });

  it("reports a clean failure when the engine's manifest cannot be read", () => {
    // The engine claims success but points at a file that is not there. This is
    // the path that must not fall through to a text error on stderr and break
    // --json.
    const { build } = builder({ manifestPath: join(dir, "does-not-exist.json") });

    const result = evidenceBuild(dir, { json: true, git, builder: build });

    expect(result.exitCode).toBe(ExitCode.VerificationFailed);
    expect(JSON.parse(result.stdout)).toMatchObject({ built: true, verified: false });
  });
});

describe("finding the evidence engine service", () => {
  it("does not depend on the working directory", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "pf-cwd-"));
    const original = process.cwd();

    process.chdir(elsewhere);
    try {
      const result = runEngine(dir, context, { outputDir: dir });
      // Either it ran, or uv is absent. What it must not be is "failed", which
      // would mean we mistook a missing engine for a broken one.
      expect(result.status).not.toBe("failed");
    } finally {
      process.chdir(original);
    }
  });

  it("reports a configured directory that holds no engine", () => {
    const empty = mkdtempSync(join(tmpdir(), "pf-noengine-"));
    const previous = process.env.PROOFFORGE_EVIDENCE_DIR;

    process.env.PROOFFORGE_EVIDENCE_DIR = empty;
    try {
      const result = runEngine(dir, context, { outputDir: dir });

      expect(result.status).toBe("unavailable");
      expect(result.detail).toContain("not found");
    } finally {
      if (previous === undefined) delete process.env.PROOFFORGE_EVIDENCE_DIR;
      else process.env.PROOFFORGE_EVIDENCE_DIR = previous;
    }
  });
});

describe("reading owner and name from a git remote", () => {
  it("parses an HTTPS remote, with or without the .git suffix", () => {
    expect(parseRemote("https://github.com/acme/widget.git", "/repo")).toEqual({
      owner: "acme",
      name: "widget",
    });
    expect(parseRemote("https://github.com/acme/widget", "/repo")).toEqual({
      owner: "acme",
      name: "widget",
    });
  });

  it("parses an SSH remote", () => {
    expect(parseRemote("git@github.com:acme/widget.git", "/repo")).toEqual({
      owner: "acme",
      name: "widget",
    });
  });

  it("falls back to the directory name when there is no remote", () => {
    // No remote is not a failure: a local repository still has a change to prove,
    // and its directory name is the most honest guess for what it is.
    expect(parseRemote(null, join("/tmp", "my-project"))).toEqual({
      owner: "local",
      name: "my-project",
    });
  });
});
