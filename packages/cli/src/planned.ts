/**
 * Commands that are declared so `--help` lists them, but do not work yet.
 *
 * They exit non-zero. A caller that cannot tell "did nothing" from "succeeded"
 * is the failure this project exists to prevent, and shipping it in our own CLI
 * would be the least defensible place to have it.
 */

import { ExitCode } from "./exit-codes.js";

export interface PlannedCommand {
  readonly name: string;
  readonly description: string;
  /**
   * Why it is unavailable. Deliberately not a phase number: "arrives in Phase 6"
   * reads as available once that phase ships, and two of these outlived theirs.
   */
  readonly note: string;
}

export const PLANNED: readonly PlannedCommand[] = [
  {
    name: "init",
    description: "Scaffold a proofforge-policy.yml in the current repo",
    note: "not implemented yet",
  },
  {
    name: "run",
    description: "Run an agent task against a repository",
    note: "agents are not wired into the CLI yet",
  },
];

export function unavailableNotice(command: PlannedCommand): {
  readonly message: string;
  readonly exitCode: number;
} {
  return {
    message: `"proofforge ${command.name}" is unavailable: ${command.note}.`,
    // A usage error rather than a verification failure: nothing was verified,
    // so there is no verdict to report.
    exitCode: ExitCode.UsageError,
  };
}
