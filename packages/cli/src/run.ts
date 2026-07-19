import { CliError } from "./io.js";
import { fail, type CommandResult } from "./output.js";
import { ExitCode } from "./exit-codes.js";

/**
 * Executes a command function, printing its output and translating thrown
 * CliErrors into stderr messages + exit codes. Returns the exit code so tests
 * can assert on it without touching the process.
 */
export function runCommand(fn: () => CommandResult): number {
  try {
    const result = fn();
    if (result.stdout) process.stdout.write(`${result.stdout}\n`);
    return result.exitCode;
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${fail(err.message)}\n`);
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${fail(`Unexpected error: ${message}`)}\n`);
    return ExitCode.UsageError;
  }
}
