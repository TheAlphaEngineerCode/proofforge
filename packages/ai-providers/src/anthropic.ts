/**
 * The Anthropic provider.
 *
 * Requests stream because agent prompts carry a diff plus its surrounding
 * context and the replies are long; a non-streaming call at these token counts
 * risks an HTTP timeout that would look like a model failure.
 */

import { costUsd } from "./pricing.js";
import type { AiProvider, CompletionRequest, CompletionResult, StopReason } from "./types.js";

export const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * The slice of the SDK we use. Narrowing it here keeps the tests honest — they
 * exercise our translation of the response, not a reimplementation of the SDK.
 */
export interface AnthropicMessage {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly model: string;
  readonly stop_reason: string | null;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_input_tokens?: number | null;
  };
}

export interface AnthropicClientPort {
  readonly messages: {
    stream(params: Record<string, unknown>): { finalMessage(): Promise<AnthropicMessage> };
  };
}

export interface AnthropicProviderOptions {
  readonly client: AnthropicClientPort;
  readonly model?: string;
  /** Injectable so duration assertions don't depend on the wall clock. */
  readonly now?: () => number;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly model: string;

  readonly #client: AnthropicClientPort;
  readonly #now: () => number;

  constructor(options: AnthropicProviderOptions) {
    this.#client = options.client;
    this.model = options.model ?? DEFAULT_MODEL;
    this.#now = options.now ?? (() => Date.now());
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const started = this.#now();

    const stream = this.#client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      // Adaptive thinking lets the model decide how much reasoning a given
      // change deserves. We never surface the reasoning, so its display stays
      // at the default; effort is the knob we actually tune.
      thinking: { type: "adaptive" },
      output_config: { effort: request.effort ?? "high" },
    });

    const message = await stream.finalMessage();
    const durationMs = this.#now() - started;

    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;

    return {
      text: textOf(message),
      provider: this.name,
      model: message.model,
      stopReason: stopReasonOf(message.stop_reason),
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
        costUsd: costUsd(message.model, inputTokens, outputTokens),
      },
      durationMs,
    };
  }
}

function textOf(message: AnthropicMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function stopReasonOf(raw: string | null): StopReason {
  switch (raw) {
    case "end_turn":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      // Anything else — tool_use, pause_turn, a reason added after this was
      // written — is not an answer we should parse. Say so rather than let it
      // pass as a completed turn.
      return "other";
  }
}
