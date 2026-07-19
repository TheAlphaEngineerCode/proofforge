/**
 * A scripted provider.
 *
 * Agent behaviour is decided by a model, so tests that let a real one answer
 * would assert on something that can change between runs. This provider replays
 * fixed replies, which keeps the tests about our orchestration — the parsing,
 * the containment, the accounting — and honest about what they cover: they say
 * nothing about how a real model responds.
 */

import { costUsd } from "./pricing.js";
import type { AiProvider, CompletionRequest, CompletionResult, StopReason } from "./types.js";

export interface ScriptedReply {
  readonly text: string;
  readonly stopReason?: StopReason;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export class FakeProvider implements AiProvider {
  readonly name = "fake";
  readonly model: string;

  readonly #replies: ScriptedReply[];
  /** Every request received, so tests can assert on what we actually sent. */
  readonly requests: CompletionRequest[] = [];

  constructor(replies: readonly (ScriptedReply | string)[], model = "fake-model") {
    this.model = model;
    this.#replies = replies.map((reply) => (typeof reply === "string" ? { text: reply } : reply));
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);

    const reply = this.#replies.shift();
    if (reply === undefined) {
      throw new Error(
        `FakeProvider ran out of replies on call ${this.requests.length}; script one more.`,
      );
    }

    const inputTokens = reply.inputTokens ?? 0;
    const outputTokens = reply.outputTokens ?? 0;

    return {
      text: reply.text,
      provider: this.name,
      model: this.model,
      stopReason: reply.stopReason ?? "end_turn",
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens: 0,
        costUsd: costUsd(this.model, inputTokens, outputTokens),
      },
      durationMs: 0,
    };
  }
}
