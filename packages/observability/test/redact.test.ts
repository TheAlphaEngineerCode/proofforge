/**
 * Credentials must not survive a trip through a log line.
 *
 * Logs go to a file, a shipper, a terminal someone screenshots. A secret that
 * reaches one is disclosed however careful the code around it was.
 */
import { describe, expect, it } from "vitest";

import { redact, redactValue } from "../src/redact.js";

describe("redacting text", () => {
  it.each([
    ["an Anthropic key", "failed with sk-ant-api03-AbCdEf123456789"],
    ["a GitHub token", "using ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"],
    ["a GitLab token", "glpat-AbCdEfGhIjKlMnOpQr"],
    ["a Slack token", "xoxb-1234567890-ABCDEFGHIJK"],
  ])("removes %s", (_case, text) => {
    const out = redact(text);

    expect(out).not.toContain("ABCDEF");
    expect(out).not.toContain("AbCdEf");
    expect(out).toContain("redacted");
  });

  it("removes a value introduced as a credential, whatever it looks like", () => {
    // The prefix patterns cannot help here; the name is the only signal.
    expect(redact("password: hunter2andthensome")).not.toContain("hunter2");
    expect(redact('api_key="plainlookingvalue"')).not.toContain("plainlooking");
  });

  it("removes credentials embedded in a URL", () => {
    const out = redact("cloning https://user:s3cr3tpassword@github.com/acme/api.git");

    expect(out).not.toContain("s3cr3tpassword");
    // The rest of the URL survives, because it is what makes the line useful.
    expect(out).toContain("github.com/acme/api.git");
  });

  it("keeps the repository visible in a failed git clone", () => {
    // The line that sent me here: the named-credential pattern ran first and
    // took the host and the path with it, leaving something safe and useless.
    const out = redact(
      "fatal: could not read from https://x-access-token:ghs_16CabcdefGHIJKLMNOPQRST@github.com/acme/api.git/",
    );

    expect(out).not.toContain("ghs_16C");
    expect(out).toContain("github.com/acme/api.git");
  });

  it("leaves ordinary text alone", () => {
    const message = "analysis 9c82fd1 finished in 4.2s with 3 collectors unavailable";

    expect(redact(message)).toBe(message);
  });
});

describe("redacting structures", () => {
  it("reaches into nested objects", () => {
    const out = redactValue({ request: { headers: { authorization: "Bearer abc123def456" } } });

    expect(JSON.stringify(out)).not.toContain("abc123def456");
  });

  it("drops a field whose name says it is a secret", () => {
    // The name is better evidence than the shape: this value looks like nothing.
    const out = redactValue({ apiKey: "x" }) as Record<string, unknown>;

    expect(out.apiKey).toBe("[redacted]");
  });

  it("redacts inside arrays", () => {
    const out = redactValue(["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"]) as string[];

    expect(out[0]).not.toContain("ABCDEF");
  });

  it("keeps non-string values as they are", () => {
    expect(redactValue({ count: 3, ok: true, missing: null })).toEqual({
      count: 3,
      ok: true,
      missing: null,
    });
  });

  it("stops rather than following a cycle forever", () => {
    const looped: Record<string, unknown> = {};
    looped.self = looped;

    // Depth-limited instead of recursing until the stack gives out.
    expect(() => redactValue(looped)).not.toThrow();
  });
});
