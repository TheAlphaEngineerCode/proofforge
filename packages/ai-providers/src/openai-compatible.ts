/**
 * Any server that speaks OpenAI's chat-completions shape.
 *
 * One provider covers Groq, OpenRouter and a local Ollama, which is what makes
 * it worth having: the agent loop, the parsing of real (messy) model output and
 * the injection defences can be exercised for free, offline if need be, without
 * a paid key. What it does not exercise is the Anthropic request shape — the
 * adaptive thinking and effort knobs live only there — so a run against this
 * provider verifies the agent, not the production path.
 *
 * Plain fetch rather than an SDK: the request is one POST of a JSON body, and
 * the servers this targets are OpenAI-compatible to varying degrees. Depending
 * on a client library would mean inheriting its assumptions about which of them
 * is the real one.
 */

import { costUsd } from "./pricing.js";
import type { AiProvider, CompletionRequest, CompletionResult, StopReason } from "./types.js";

/** Endpoints known to speak this dialect, for callers that want a default. */
export const KNOWN_BASE_URLS = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
} as const;

type Fetch = typeof globalThis.fetch;

/**
 * Ours, so the timeout handler can tell an error we raised from one the network
 * raised. Without the distinction, a 400 that arrives just as the clock expires
 * gets reported as a timeout and the actual message is lost.
 */
class ProviderError extends Error {}

export interface OpenAiCompatibleOptions {
  /** Root of the API, without a trailing `/chat/completions`. */
  readonly baseUrl: string;
  /** Sent as a bearer token. Ollama ignores it, so any placeholder works there. */
  readonly apiKey: string;
  readonly model: string;
  /**
   * A local model on CPU can take minutes, and a hung socket is worse than a
   * failure: the run would sit there looking like work in progress.
   */
  readonly timeoutMs?: number;
  /** Injectable so tests exercise our translation, not the network. */
  readonly fetch?: Fetch;
  readonly now?: () => number;
}

interface ChatResponse {
  readonly model?: string;
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_tokens_details?: { readonly cached_tokens?: number };
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  readonly model: string;

  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: Fetch;
  readonly #now: () => number;

  constructor(options: OpenAiCompatibleOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.model = options.model;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    // Wrapped rather than referenced: `fetch` detached from its global throws
    // in a browser and in some runtimes, and this package has no reason to
    // decide it is Node-only.
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#now = options.now ?? (() => Date.now());
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const started = this.#now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let body: ChatResponse;
    try {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          // This dialect carries the system prompt as the first message rather
          // than a field of its own.
          messages: [
            { role: "system", content: request.system },
            ...request.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          // `request.effort` is deliberately dropped: there is no equivalent
          // knob here, and mapping it onto temperature would be inventing a
          // relationship rather than honouring one.
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The body, not the request: echoing what we sent would put the bearer
        // token into an error string that gets logged and put in a manifest.
        throw new ProviderError(
          `provider returned ${response.status}: ${truncate(await safeText(response))}`,
        );
      }

      // Reading the body stays inside the timeout. Headers can arrive promptly
      // and the body then trickle or stall — clearing the timer any earlier
      // left exactly the indefinite wait this option exists to prevent.
      // Not `safeText` here: on the success path a read that fails is the
      // abort, and swallowing it would report a timeout as malformed JSON.
      const raw = await response.text();
      try {
        body = JSON.parse(raw) as ChatResponse;
      } catch {
        // An HTML error page from a proxy, most often. Saying the body was not
        // JSON beats surfacing a parser's complaint about character 0.
        throw new ProviderError(`provider did not return JSON: ${truncate(raw)}`);
      }
    } catch (err) {
      // An abort surfaces as a generic error, and "it timed out" versus "the
      // network failed" is the first thing anyone debugging wants to know.
      if (controller.signal.aborted && !(err instanceof ProviderError)) {
        throw new Error(`model did not respond within ${this.#timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const durationMs = this.#now() - started;
    const choice = body.choices?.[0];
    const model = body.model ?? this.model;
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;

    return {
      // Null content is how this dialect reports a refusal or a tool call. An
      // empty string is the honest translation; the caller already treats an
      // empty answer as a failure rather than an empty result.
      text: choice?.message?.content ?? "",
      provider: this.name,
      model,
      stopReason: stopReasonOf(choice?.finish_reason ?? null),
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        // Null for every model here, since none is in the rate table. That is
        // the point: an unknown cost must not be recorded as a measured zero.
        costUsd: costUsd(model, inputTokens, outputTokens),
      },
      durationMs,
    };
  }
}

function stopReasonOf(raw: string | null): StopReason {
  switch (raw) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      // tool_calls, a null from a server that omits the field, anything added
      // later: not an answer to parse, and saying so beats guessing.
      return "other";
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}

function truncate(text: string): string {
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}
