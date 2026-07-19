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

/** Read and JSON-parse a file, converting failures into a CliError. */
export function readJsonFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new CliError(`Cannot read file: ${path}`, ExitCode.UsageError);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CliError(`Invalid JSON in ${path}: ${detail}`, ExitCode.UsageError);
  }
}
