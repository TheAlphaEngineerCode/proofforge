import { describe, expect, it } from "vitest";
import { redactToken } from "../src/app.js";

describe("redactToken", () => {
  it("redacts a session token from the SSE URL", () => {
    expect(redactToken("/api/v1/analyses/abc/events?token=s3cr3t")).toBe(
      "/api/v1/analyses/abc/events?token=REDACTED",
    );
  });

  it("redacts token among other query params", () => {
    expect(redactToken("/x?foo=1&token=abc&bar=2")).toBe("/x?foo=1&token=REDACTED&bar=2");
  });

  it("leaves URLs without a token untouched", () => {
    expect(redactToken("/api/v1/me")).toBe("/api/v1/me");
  });
});
