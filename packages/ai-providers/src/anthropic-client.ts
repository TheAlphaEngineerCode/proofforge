/**
 * Constructing a live Anthropic client.
 *
 * This is the piece that was missing: the SDK has been a dependency and
 * `AnthropicProvider` has been tested since Phase 7, but nothing ever built a
 * real client, so no code path read an API key and the production provider had
 * never issued a request. The provider took an injected port precisely so the
 * tests could stay honest — this module is the other half of that seam.
 *
 * Kept apart from `anthropic.ts` on purpose: importing the SDK here means the
 * fake provider, the CLI and every test can use the package without pulling in
 * a client they will never construct.
 */

import Anthropic from "@anthropic-ai/sdk";

import { AnthropicProvider, DEFAULT_MODEL, type AnthropicClientPort } from "./anthropic.js";

export interface LiveAnthropicOptions {
  /** Falls back to ANTHROPIC_API_KEY, which is how it is normally supplied. */
  readonly apiKey?: string;
  readonly model?: string;
  /**
   * Agent prompts carry a diff plus its context and the replies are long, so a
   * request can legitimately run for minutes. The SDK's ten-minute default is
   * the right order of magnitude; this exists to lower it, not to raise it.
   */
  readonly timeoutMs?: number;
}

/**
 * A provider backed by the real API.
 *
 * Throws when no key is configured rather than constructing a client that
 * fails later on the first request: a missing credential is a setup problem,
 * and finding out at startup beats finding out halfway through a run.
 */
export function createAnthropicProvider(options: LiveAnthropicOptions = {}): AnthropicProvider {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({
    apiKey,
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });

  return new AnthropicProvider({
    // The cast is deliberate and the compiler is right to want it: the port
    // declares `stream(params: Record<string, unknown>)` while the SDK requires
    // model, max_tokens and messages, and a function accepting less cannot
    // stand in for one accepting more. The reply shapes do match, and the port
    // stays loose so the tests exercise our translation of a reply rather than
    // a reimplementation of the SDK's request types.
    client: client as unknown as AnthropicClientPort,
    model: options.model ?? DEFAULT_MODEL,
  });
}
