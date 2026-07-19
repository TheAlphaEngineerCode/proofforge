/**
 * The completion surface every provider implements.
 *
 * Deliberately small. ProofForge asks models to do one thing — read a bounded
 * amount of context and produce text we then parse against a schema — so the
 * interface carries nothing a second provider would have to fake.
 */

export type Role = "user" | "assistant";

export interface Message {
  readonly role: Role;
  readonly content: string;
}

/**
 * How hard the model should work. Providers map this onto whatever knob they
 * have; a provider without one ignores it rather than pretending to honour it.
 */
export type Effort = "low" | "medium" | "high";

export interface CompletionRequest {
  /** Instructions from us. Never contains repository content — see `untrusted`. */
  readonly system: string;
  readonly messages: readonly Message[];
  readonly maxTokens: number;
  readonly effort?: Effort;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens served from the provider's cache, when it reports them. */
  readonly cachedInputTokens: number;
  /**
   * Computed from the model's published rates. Null when we have no rate for
   * the model, so an unknown cost is never silently recorded as zero — the same
   * distinction the evidence collectors draw.
   */
  readonly costUsd: number | null;
}

/**
 * Why generation stopped. `refusal` and `max_tokens` both mean the text is not
 * a complete answer, and callers must not parse it as one.
 */
export type StopReason = "end_turn" | "max_tokens" | "refusal" | "other";

export interface CompletionResult {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly stopReason: StopReason;
  readonly usage: Usage;
  readonly durationMs: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
