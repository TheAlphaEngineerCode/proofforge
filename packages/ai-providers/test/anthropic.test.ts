import { describe, expect, it } from "vitest";

import { AnthropicProvider, type AnthropicMessage } from "../src/anthropic.js";

function clientReturning(message: Partial<AnthropicMessage>): {
  client: { messages: { stream(params: Record<string, unknown>): { finalMessage(): Promise<AnthropicMessage> } } };
  sent: Record<string, unknown>[];
} {
  const sent: Record<string, unknown>[] = [];
  const full: AnthropicMessage = {
    content: [{ type: "text", text: "ok" }],
    model: "claude-opus-4-8",
    stop_reason: "end_turn",
    usage: { input_tokens: 0, output_tokens: 0 },
    ...message,
  };

  return {
    sent,
    client: {
      messages: {
        stream(params) {
          sent.push(params);
          return { finalMessage: async () => full };
        },
      },
    },
  };
}

const request = {
  system: "You review changes.",
  messages: [{ role: "user" as const, content: "Review this diff." }],
  maxTokens: 4096,
};

function onlyRequest(sent: Record<string, unknown>[]): Record<string, unknown> {
  const params = sent[0];
  if (params === undefined) throw new Error("the provider sent no request");
  return params;
}

describe("the request we send", () => {
  it("streams, because these prompts and replies are long", async () => {
    const { client, sent } = clientReturning({});

    await new AnthropicProvider({ client }).complete(request);

    // The seam is `messages.stream`; a non-streaming call would not reach it.
    expect(sent).toHaveLength(1);
    expect(onlyRequest(sent).max_tokens).toBe(4096);
  });

  it("carries no sampling parameters, which this model rejects", async () => {
    const { client, sent } = clientReturning({});

    await new AnthropicProvider({ client }).complete(request);

    expect(onlyRequest(sent)).not.toHaveProperty("temperature");
    expect(onlyRequest(sent)).not.toHaveProperty("top_p");
    expect(onlyRequest(sent)).not.toHaveProperty("top_k");
  });

  it("asks for adaptive thinking rather than a fixed budget", async () => {
    const { client, sent } = clientReturning({});

    await new AnthropicProvider({ client }).complete(request);

    expect(onlyRequest(sent).thinking).toEqual({ type: "adaptive" });
  });
});

describe("the result we report", () => {
  it("joins the text blocks and prices the call", async () => {
    const { client } = clientReturning({
      content: [
        { type: "thinking", text: undefined },
        { type: "text", text: "No blocking issues" },
        { type: "text", text: " were found." },
      ],
      usage: { input_tokens: 200_000, output_tokens: 40_000 },
    });

    const result = await new AnthropicProvider({ client }).complete(request);

    expect(result.text).toBe("No blocking issues were found.");
    // 0.2M in at $5 + 0.04M out at $25 = $1.00 + $1.00
    expect(result.usage.costUsd).toBeCloseTo(2.0, 6);
  });

  it("leaves cost null for a model we have no rate for", async () => {
    const { client } = clientReturning({
      model: "claude-something-unreleased",
      usage: { input_tokens: 1000, output_tokens: 1000 },
    });

    const result = await new AnthropicProvider({ client }).complete(request);

    // Null, not zero: an unknown cost must not read as a free call.
    expect(result.usage.costUsd).toBeNull();
  });

  it("surfaces a refusal instead of passing the text off as an answer", async () => {
    const { client } = clientReturning({ stop_reason: "refusal", content: [] });

    const result = await new AnthropicProvider({ client }).complete(request);

    expect(result.stopReason).toBe("refusal");
  });

  it("reports truncation, which would otherwise parse as a short answer", async () => {
    const { client } = clientReturning({ stop_reason: "max_tokens" });

    expect((await new AnthropicProvider({ client }).complete(request)).stopReason).toBe(
      "max_tokens",
    );
  });

  it("does not treat an unfamiliar stop reason as a completed turn", async () => {
    const { client } = clientReturning({ stop_reason: "pause_turn" });

    expect((await new AnthropicProvider({ client }).complete(request)).stopReason).toBe("other");
  });

  it("reports the model that answered, not the one we asked for", async () => {
    const { client } = clientReturning({ model: "claude-opus-4-7" });

    const result = await new AnthropicProvider({ client, model: "claude-opus-4-8" }).complete(
      request,
    );

    expect(result.model).toBe("claude-opus-4-7");
  });
});
