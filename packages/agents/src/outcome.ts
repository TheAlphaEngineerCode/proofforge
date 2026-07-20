/**
 * The shape every agent returns.
 *
 * An agent either produced what it was asked for, or it did not — and "did not"
 * has to be a distinct state rather than an empty result. A planner that returns
 * no steps because the model refused looks exactly like a planner that decided
 * no work is needed, and only one of those should let a run continue.
 */

import type { CompletionResult } from "@proofforge/ai-providers";
import { redact } from "@proofforge/observability";

export type AgentOutcome<T> =
  | {
      readonly status: "ok";
      readonly value: T;
      /** Redirection attempts seen in the material the agent read. */
      readonly injectionSignals: readonly string[];
      readonly usage: CompletionResult["usage"];
    }
  | {
      readonly status: "failed";
      readonly reason: string;
      readonly usage: CompletionResult["usage"] | null;
    };

export function failed<T>(
  reason: string,
  usage: CompletionResult["usage"] | null = null,
): AgentOutcome<T> {
  return { status: "failed", reason, usage };
}

/**
 * Why a completion cannot be parsed as an answer.
 *
 * Returns null when the model finished normally, so the caller can go on to
 * parse it. Anything else means the text is not a complete reply, whatever it
 * happens to contain.
 */
export function stopReasonProblem(result: CompletionResult): string | null {
  if (result.stopReason === "end_turn") return null;
  return `the model stopped with "${result.stopReason}" before finishing`;
}

/** Provider errors reach the manifest, and a manifest can be published. */
export function describeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}
