/**
 * Stable process exit codes so ProofForge can gate CI pipelines.
 */
export const ExitCode = {
  /** Everything passed. */
  Success: 0,
  /** The manifest/evidence failed verification (structure, hash or signature). */
  VerificationFailed: 1,
  /** Usage error: bad arguments, missing or unreadable file, invalid JSON. */
  UsageError: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
