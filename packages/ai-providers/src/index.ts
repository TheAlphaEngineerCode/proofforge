export type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  Effort,
  Message,
  Role,
  StopReason,
  Usage,
} from "./types.js";

export { RATES, costUsd, type Rate } from "./pricing.js";

export {
  UNTRUSTED_CONTENT_RULES,
  detectInjectionSignals,
  encloseUntrusted,
  type UntrustedContent,
} from "./untrusted.js";

export {
  AnthropicProvider,
  DEFAULT_MODEL,
  type AnthropicClientPort,
  type AnthropicMessage,
  type AnthropicProviderOptions,
} from "./anthropic.js";

export { createAnthropicProvider, type LiveAnthropicOptions } from "./anthropic-client.js";

export {
  KNOWN_BASE_URLS,
  OpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
} from "./openai-compatible.js";

export { FakeProvider, type ScriptedReply } from "./fake.js";
