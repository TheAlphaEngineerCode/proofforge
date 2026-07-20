/**
 * `proofforge init`.
 *
 * The file this writes is what decides whether changes get through, so the two
 * things worth protecting are that it parses and that it never quietly replaces
 * a policy someone is already relying on.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, evaluatePolicy } from "@proofforge/policy-engine";
import { describe, expect, it } from "vitest";

import { POLICY_FILENAME, init } from "../src/commands/init.js";
import { ExitCode } from "../src/exit-codes.js";
import { buildManifest } from "./fixtures.js";

function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), "pf-init-"));
}

function policyIn(dir: string): string {
  return readFileSync(join(dir, POLICY_FILENAME), "utf8");
}

describe("writing the policy", () => {
  it("writes a file the policy engine accepts", () => {
    const dir = emptyDir();

    const result = init({ cwd: dir });

    expect(result.exitCode).toBe(ExitCode.Success);
    // A starting point that fails on first use is worse than none.
    expect(() => loadPolicy(policyIn(dir))).not.toThrow();
  });

  it("produces a policy that actually judges a manifest", () => {
    const dir = emptyDir();
    init({ cwd: dir });

    const report = evaluatePolicy(loadPolicy(policyIn(dir)), buildManifest());

    expect(report.decision).toBeDefined();
  });

  it("blocks an irreversible migration out of the box", () => {
    const dir = emptyDir();
    init({ cwd: dir });
    const manifest = buildManifest({
      collectors: [{ name: "operations", status: "ok", detail: "", durationMs: 1 }],
      operations: {
        migrationsDetected: true,
        migrationsReversible: false,
        rollbackAvailable: false,
        downtimeRequired: false,
      },
    });

    const report = evaluatePolicy(loadPolicy(policyIn(dir)), manifest);

    expect(report.failed.map((outcome) => outcome.rule)).toContain(
      "operations.reversibleMigrationsRequired",
    );
  });

  it("explains its own settings", () => {
    const dir = emptyDir();
    init({ cwd: dir });

    // A policy nobody understands gets loosened the first time it says no.
    const text = policyIn(dir);
    expect(text).toContain("onUnverifiable");
    expect(text.split("\n").filter((line) => line.trim().startsWith("#")).length).toBeGreaterThan(
      10,
    );
  });
});

describe("an existing policy", () => {
  it("is not overwritten by default", () => {
    const dir = emptyDir();
    writeFileSync(join(dir, POLICY_FILENAME), "version: \"1.0\"\nname: mine\n", "utf8");

    const result = init({ cwd: dir });

    expect(result.exitCode).toBe(ExitCode.UsageError);
    // The file on disk may be the one governing the repository.
    expect(policyIn(dir)).toContain("name: mine");
  });

  it("says how to overwrite it", () => {
    const dir = emptyDir();
    writeFileSync(join(dir, POLICY_FILENAME), "name: mine\n", "utf8");

    expect(init({ cwd: dir }).stdout).toContain("--force");
  });

  it("is replaced when the caller asks", () => {
    const dir = emptyDir();
    writeFileSync(join(dir, POLICY_FILENAME), "name: mine\n", "utf8");

    const result = init({ cwd: dir, force: true });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(policyIn(dir)).toContain("name: starter");
  });
});
