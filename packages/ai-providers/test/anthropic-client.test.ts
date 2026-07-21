/**
 * Constructing the live client.
 *
 * There is little to assert here without spending money, and that is the point:
 * the only behaviour worth pinning is that a missing key fails at construction
 * rather than halfway through a run.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAnthropicProvider } from "../src/anthropic-client.js";
import { DEFAULT_MODEL } from "../src/anthropic.js";

describe("createAnthropicProvider", () => {
  const original = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("refuses to build a client with no key", () => {
    expect(() => createAnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("treats an empty key as missing", () => {
    // The shape a half-configured .env produces, and the one that otherwise
    // fails much later with an unhelpful 401.
    process.env.ANTHROPIC_API_KEY = "";

    expect(() => createAnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("reads the key from the environment", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    expect(createAnthropicProvider().model).toBe(DEFAULT_MODEL);
  });

  it("prefers an explicit key over the environment", () => {
    expect(() => createAnthropicProvider({ apiKey: "sk-ant-test" })).not.toThrow();
  });

  it("uses the model it was given", () => {
    const provider = createAnthropicProvider({ apiKey: "sk-ant-test", model: "claude-haiku-4-5" });

    expect(provider.model).toBe("claude-haiku-4-5");
  });
});
