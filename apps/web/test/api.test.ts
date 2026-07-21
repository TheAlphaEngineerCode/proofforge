/**
 * The API client's error and auth handling.
 *
 * These are the paths a user only meets when something has already gone wrong,
 * which is exactly why they are the ones that go untested and then swallow the
 * information someone needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analysisEventsUrl, api, ApiError, errorMessage } from "@/lib/api";
import { clearToken, setToken } from "@/lib/session";

function respondWith(body: unknown, init: ResponseInit = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body === undefined ? null : JSON.stringify(body), {
          headers: { "content-type": "application/json" },
          ...init,
        }),
    ),
  );
}

function lastRequest(): [string, RequestInit] {
  const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return mock.mock.calls[0] as [string, RequestInit];
}

describe("authentication", () => {
  beforeEach(() => {
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it("sends the stored token as a bearer header", async () => {
    setToken("tok_abc");
    respondWith({ id: "u_1" });

    await api.me();

    const headers = new Headers(lastRequest()[1].headers);
    expect(headers.get("authorization")).toBe("Bearer tok_abc");
  });

  it("omits the header entirely when signed out", async () => {
    respondWith({ id: "u_1" });

    await api.me();

    // Not `Bearer null` — the API would reject that as a malformed token
    // rather than treating the request as anonymous.
    expect(new Headers(lastRequest()[1].headers).has("authorization")).toBe(false);
  });
});

describe("errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the API's own message", async () => {
    respondWith({ error: "repository not connected" }, { status: 409 });

    await expect(api.me()).rejects.toThrow("repository not connected");
  });

  it("carries the status code for the caller to branch on", async () => {
    respondWith({ error: "nope" }, { status: 403 });

    await expect(api.me()).rejects.toMatchObject({ status: 403 });
  });

  it("falls back to the status text when the body is not JSON", async () => {
    // A proxy or gateway error page, which is when this path actually runs.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502, statusText: "Bad Gateway" })),
    );

    await expect(api.me()).rejects.toThrow("Bad Gateway");
  });

  it("returns nothing for a 204 rather than trying to parse it", async () => {
    // `new Response(null, {status: 204})` is the only legal way to build one;
    // parsing it as JSON would throw on an empty body.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await expect(api.me()).resolves.toBeUndefined();
  });
});

describe("describing an error to the user", () => {
  it("uses the API message when there is one", () => {
    expect(errorMessage(new ApiError(400, "commitSha is required"))).toBe("commitSha is required");
  });

  it("falls back for a plain error", () => {
    expect(errorMessage(new Error("network down"))).toBe("network down");
  });

  it("says something rather than rendering an object", () => {
    // A thrown non-Error reaches here; "[object Object]" in the UI is the
    // failure this guards against.
    expect(errorMessage({ weird: true })).toBe("unexpected error");
  });
});

describe("the event stream url", () => {
  afterEach(() => {
    clearToken();
  });

  it("carries the token, because EventSource cannot set headers", () => {
    setToken("tok_abc");

    expect(analysisEventsUrl("an_1")).toContain("token=tok_abc");
  });

  it("escapes a token that would otherwise break the query string", () => {
    setToken("a&b=c");

    expect(analysisEventsUrl("an_1")).toContain("token=a%26b%3Dc");
  });

  it("still produces a valid url when signed out", () => {
    expect(analysisEventsUrl("an_1")).toContain("token=");
  });
});
