/**
 * Translation of the OpenAI chat-completions dialect into our result shape.
 *
 * The parts worth pinning are the ones where a wrong answer looks like a right
 * one: a truncated reply read as a complete turn, or an unknown cost recorded
 * as zero.
 */
import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleProvider } from "../src/openai-compatible.js";
import type { CompletionRequest } from "../src/types.js";

const REQUEST: CompletionRequest = {
  system: "You review changes.",
  messages: [{ role: "user", content: "Review this diff." }],
  maxTokens: 1024,
};

function respondWith(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof globalThis.fetch;
}

function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "llama-3.3-70b-versatile",
    choices: [{ message: { content: "looks fine" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 40 },
    ...overrides,
  };
}

function provider(fetchImpl: typeof globalThis.fetch, now?: () => number) {
  return new OpenAiCompatibleProvider({
    baseUrl: "https://api.groq.com/openai/v1/",
    apiKey: "test-key",
    model: "llama-3.3-70b-versatile",
    fetch: fetchImpl,
    ...(now ? { now } : {}),
  });
}

describe("sending the request", () => {
  it("carries the system prompt as the first message", async () => {
    const fetchImpl = respondWith(reply());

    await provider(fetchImpl).complete(REQUEST);

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as { messages: { role: string }[] };
    expect(body.messages[0]).toEqual({ role: "system", content: "You review changes." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Review this diff." });
  });

  it("does not double the slash when the base url has a trailing one", async () => {
    const fetchImpl = respondWith(reply());

    await provider(fetchImpl).complete(REQUEST);

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
  });
});

describe("reading the reply", () => {
  it("returns the text, the model the server actually used, and the usage", async () => {
    let clock = 1000;
    const result = await provider(respondWith(reply()), () => (clock += 250)).complete(REQUEST);

    expect(result.text).toBe("looks fine");
    expect(result.model).toBe("llama-3.3-70b-versatile");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(120);
    expect(result.usage.outputTokens).toBe(40);
    expect(result.durationMs).toBe(250);
  });

  it("reports an unknown cost as null, never as zero", async () => {
    // No Groq model is in the rate table. A zero here would read as a measured
    // cost of nothing, which is the failure this project exists to avoid.
    const result = await provider(respondWith(reply())).complete(REQUEST);

    expect(result.usage.costUsd).toBeNull();
  });

  it.each([
    ["length", "max_tokens"],
    ["content_filter", "refusal"],
    ["tool_calls", "other"],
    [null, "other"],
  ])("maps finish_reason %s to %s", async (finish, expected) => {
    const result = await provider(
      respondWith(reply({ choices: [{ message: { content: "x" }, finish_reason: finish }] })),
    ).complete(REQUEST);

    // A truncated reply must never be presented as a completed turn.
    expect(result.stopReason).toBe(expected);
  });

  it("treats null content as empty rather than as the string 'null'", async () => {
    const result = await provider(
      respondWith(reply({ choices: [{ message: { content: null }, finish_reason: "stop" }] })),
    ).complete(REQUEST);

    expect(result.text).toBe("");
  });

  it("survives a server that omits usage entirely", async () => {
    // Ollama has done this. Reading through undefined would throw here, and the
    // whole run would fail on a field nobody needs.
    const result = await provider(respondWith(reply({ usage: undefined }))).complete(REQUEST);

    expect(result.usage.inputTokens).toBe(0);
    expect(result.text).toBe("looks fine");
  });

  it("counts cached tokens when the server reports them", async () => {
    const result = await provider(
      respondWith(reply({ usage: { prompt_tokens: 120, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 90 } } })),
    ).complete(REQUEST);

    expect(result.usage.cachedInputTokens).toBe(90);
  });
});

describe("failures", () => {
  it("reports the status and the body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("model decommissioned", { status: 400 }),
    ) as unknown as typeof globalThis.fetch;

    await expect(provider(fetchImpl).complete(REQUEST)).rejects.toThrow(
      /400: model decommissioned/,
    );
  });

  it("keeps the api key out of the error", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("invalid api key", { status: 401 }),
    ) as unknown as typeof globalThis.fetch;

    // The key is a request header; an error that echoed the request would put
    // it into a string that gets logged and can reach a manifest.
    await expect(provider(fetchImpl).complete(REQUEST)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("test-key") }) as Error,
    );
  });

  it("says the body was not JSON, rather than blaming character 0", async () => {
    // A reverse proxy in front of a local model returns HTML on error. The
    // parser's own complaint tells you nothing about which hop failed.
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof globalThis.fetch;

    await expect(provider(fetchImpl).complete(REQUEST)).rejects.toThrow(/did not return JSON/);
  });

  it("keeps the clock running while the body is still arriving", async () => {
    // Headers can land immediately and the body then stall. Clearing the timer
    // once the response object existed left an unbounded wait here.
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const stalled = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(stalled, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const slow = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ignored",
      model: "qwen2.5-coder",
      timeoutMs: 20,
      fetch: fetchImpl,
    });

    await expect(slow.complete(REQUEST)).rejects.toThrow(/did not respond within 20ms/);
  });

  it("says so when the model does not answer in time", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      // What a hung local model looks like: the socket never resolves and the
      // abort signal is the only thing that ends the wait.
      return await new Promise<Response>((_resolve, rejectPromise) => {
        init?.signal?.addEventListener("abort", () =>
          rejectPromise(new DOMException("aborted", "AbortError")),
        );
      });
    }) as unknown as typeof globalThis.fetch;

    const slow = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ignored",
      model: "qwen2.5-coder",
      timeoutMs: 20,
      fetch: fetchImpl,
    });

    await expect(slow.complete(REQUEST)).rejects.toThrow(/did not respond within 20ms/);
  });
});
