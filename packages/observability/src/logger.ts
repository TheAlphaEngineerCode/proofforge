/**
 * Structured logging.
 *
 * One JSON object per line, because the questions worth asking of a log —
 * which analysis, which collector, how long — are queries, and a sentence is
 * not queryable. The fields go through redaction on the way out, so a log line
 * cannot carry a credential that a caller forgot about.
 */

import { redactValue } from "./redact.js";

export const LEVELS = ["debug", "info", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Fields = Record<string, unknown>;

export interface LogRecord {
  readonly time: string;
  readonly level: Level;
  readonly message: string;
  readonly fields: Fields;
}

export interface LoggerOptions {
  /** Records below this are dropped. */
  readonly level?: Level;
  /** Attached to every record — service name, version, whatever identifies this process. */
  readonly base?: Fields;
  /** Where records go. Defaults to stdout, one JSON object per line. */
  readonly sink?: (record: LogRecord) => void;
  /** Injectable so tests do not assert on the wall clock. */
  readonly now?: () => Date;
}

export class Logger {
  readonly #level: Level;
  readonly #base: Fields;
  readonly #sink: (record: LogRecord) => void;
  readonly #now: () => Date;

  constructor(options: LoggerOptions = {}) {
    this.#level = options.level ?? "info";
    this.#base = options.base ?? {};
    this.#sink = options.sink ?? writeLine;
    this.#now = options.now ?? (() => new Date());
  }

  /** A logger carrying extra fields — one per analysis, per request, per run. */
  child(fields: Fields): Logger {
    return new Logger({
      level: this.#level,
      base: { ...this.#base, ...fields },
      sink: this.#sink,
      now: this.#now,
    });
  }

  debug(message: string, fields: Fields = {}): void {
    this.#write("debug", message, fields);
  }

  info(message: string, fields: Fields = {}): void {
    this.#write("info", message, fields);
  }

  warn(message: string, fields: Fields = {}): void {
    this.#write("warn", message, fields);
  }

  error(message: string, fields: Fields = {}): void {
    this.#write("error", message, fields);
  }

  #write(level: Level, message: string, fields: Fields): void {
    if (ORDER[level] < ORDER[this.#level]) return;

    this.#sink({
      time: this.#now().toISOString(),
      level,
      // Redacted too: the message is where a caller most often interpolates
      // something they did not think of as a secret.
      message: String(redactValue(message)),
      fields: redactValue({ ...this.#base, ...fields }) as Fields,
    });
  }
}

function writeLine(record: LogRecord): void {
  process.stdout.write(`${JSON.stringify({ ...record.fields, ...withoutFields(record) })}\n`);
}

function withoutFields(record: LogRecord): Omit<LogRecord, "fields"> {
  return { time: record.time, level: record.level, message: record.message };
}

/** A logger that discards everything, for tests and for the CLI. */
export function silentLogger(): Logger {
  return new Logger({ sink: () => undefined });
}
