import { readFileSync } from "node:fs";
import { ExitCode } from "./exit-codes.js";

export class CliError extends Error {
  override readonly name = "CliError";
  constructor(
    message: string,
    readonly exitCode: ExitCode = ExitCode.UsageError,
  ) {
    super(message);
  }
}

/** Read a text file, converting failures into a CliError. */
export function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new CliError(`Cannot read file: ${path}`, ExitCode.UsageError);
  }
}

/** Read and JSON-parse a file, converting failures into a CliError. */
export function readJsonFile(path: string): unknown {
  const raw = readTextFile(path);
  try {
    return JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CliError(`Invalid JSON in ${path}: ${detail}`, ExitCode.UsageError);
  }
}
