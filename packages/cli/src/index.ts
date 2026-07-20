import { Command } from "commander";
import { SPEC_VERSION } from "@proofforge/evidence-spec";
import { manifestInspect, manifestValidate } from "./commands/manifest.js";
import { evidenceVerify } from "./commands/evidence.js";
import { policyEvaluate, policyValidate } from "./commands/policy.js";
import { runCommand } from "./run.js";
import { ExitCode } from "./exit-codes.js";

const CLI_VERSION = "0.1.0";

const program = new Command();

program
  .name("proofforge")
  .description("Autonomous Software Engineering with Verifiable Changes")
  .version(`proofforge ${CLI_VERSION} (proof-manifest spec ${SPEC_VERSION})`, "-v, --version");

const manifest = program.command("manifest").description("Work with proof-manifest documents");

manifest
  .command("validate")
  .description("Validate a proof-manifest against the schema")
  .argument("<file>", "path to a proof-manifest JSON file")
  .option("--json", "emit machine-readable JSON output", false)
  .action((file: string, opts: { json: boolean }) => {
    process.exitCode = runCommand(() => manifestValidate(file, { json: opts.json }));
  });

manifest
  .command("inspect")
  .description("Print a human-readable summary of a proof-manifest")
  .argument("<file>", "path to a proof-manifest JSON file")
  .option("--json", "emit machine-readable JSON output", false)
  .action((file: string, opts: { json: boolean }) => {
    process.exitCode = runCommand(() => manifestInspect(file, { json: opts.json }));
  });

const evidence = program.command("evidence").description("Verify evidence bundles");

evidence
  .command("verify")
  .description("Verify structure, evidence hash and (optional) signature of a manifest")
  .argument("<file>", "path to a proof-manifest JSON file")
  .option("--json", "emit machine-readable JSON output", false)
  .option("--public-key <file>", "public key (PEM or raw base64) to verify the signature")
  .option("--require-signature", "fail unless a valid signature is present", false)
  .action(
    (file: string, opts: { json: boolean; publicKey?: string; requireSignature: boolean }) => {
      process.exitCode = runCommand(() =>
        evidenceVerify(file, {
          json: opts.json,
          publicKey: opts.publicKey,
          requireSignature: opts.requireSignature,
        }),
      );
    },
  );

// ── Declared but not yet wired ──────────────────────────────────────────────
// The note says what is missing rather than naming a phase: "arrives in Phase 6"
// reads as available once that phase ships, and two of these outlived theirs.
const planned: Array<[string, string, string]> = [
  ["init", "Scaffold a proofforge-policy.yml in the current repo", "not implemented yet"],
  [
    "analyze",
    "Analyze a local repository and emit a structural report",
    "the analyzer runs as a service; this command is not wired to it",
  ],
  ["run", "Run an agent task against a repository", "agents are not wired into the CLI yet"],
];

for (const [name, description, note] of planned) {
  program
    .command(name)
    .description(`${description} (unavailable: ${note})`)
    .allowUnknownOption()
    .action(() => {
      process.stderr.write(`"proofforge ${name}" is unavailable: ${note}.\n`);
      // Non-zero, so a script calling this cannot mistake "did nothing" for
      // "succeeded". Usage error rather than verification failure: nothing was
      // verified, so there is no verdict to report.
      process.exitCode = ExitCode.UsageError;
    });
}

const policy = program.command("policy").description("Policy tooling");

policy
  .command("validate")
  .description("Validate a policy file against the policy schema")
  .argument("<file>", "path to a policy YAML file")
  .option("--json", "emit machine-readable JSON output", false)
  .action((file: string, opts: { json: boolean }) => {
    process.exitCode = runCommand(() => policyValidate(file, { json: opts.json }));
  });

policy
  .command("evaluate")
  .description("Evaluate a proof-manifest against a policy")
  .argument("<policy>", "path to a policy YAML file")
  .argument("<manifest>", "path to a proof-manifest JSON file")
  .option("--json", "emit machine-readable JSON output", false)
  .action((policyFile: string, manifestFile: string, opts: { json: boolean }) => {
    process.exitCode = runCommand(() => policyEvaluate(policyFile, manifestFile, { json: opts.json }));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
});
