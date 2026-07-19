import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhook, verifyWebhookSignature } from "../src/webhook.js";

const SECRET = "s3cr3t-webhook-key";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ hello: "world" });

  it("accepts a correct signature", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts the raw Buffer form (what the server actually receives)", () => {
    expect(verifyWebhookSignature(Buffer.from(body, "utf8"), sign(body), SECRET)).toBe(true);
  });

  it("rejects a signature produced with a different secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = sign(body);
    expect(verifyWebhookSignature(JSON.stringify({ hello: "mars" }), signature, SECRET)).toBe(false);
  });

  it("rejects missing, malformed or unprefixed signatures", () => {
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "deadbeef", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha1=deadbeef", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=short", SECRET)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(verifyWebhookSignature(body, sign(body), "")).toBe(false);
  });
});

describe("parseWebhook — pull_request", () => {
  const payload = {
    action: "opened",
    number: 42,
    pull_request: {
      number: 42,
      draft: false,
      title: "Add OAuth",
      head: { sha: "a".repeat(40), ref: "feature/oauth" },
      base: { sha: "b".repeat(40), ref: "main" },
    },
    repository: { name: "api", owner: { login: "acme" }, default_branch: "main" },
    installation: { id: 987 },
  };

  it("normalizes an analyzable pull request", () => {
    const result = parseWebhook("pull_request", payload);
    expect(result.type).toBe("pull_request");
    if (result.type !== "pull_request") return;
    expect(result.target).toMatchObject({
      installationId: 987,
      owner: "acme",
      repo: "api",
      pullRequest: 42,
      headRef: "feature/oauth",
      baseRef: "main",
      title: "Add OAuth",
    });
  });

  it.each(["synchronize", "reopened", "ready_for_review"])("analyzes action '%s'", (action) => {
    expect(parseWebhook("pull_request", { ...payload, action }).type).toBe("pull_request");
  });

  it.each(["closed", "labeled", "assigned"])("ignores action '%s'", (action) => {
    const result = parseWebhook("pull_request", { ...payload, action });
    expect(result.type).toBe("ignored");
  });

  it("ignores draft pull requests until they are ready for review", () => {
    const draft = { ...payload, pull_request: { ...payload.pull_request, draft: true } };
    expect(parseWebhook("pull_request", draft).type).toBe("ignored");
    expect(parseWebhook("pull_request", { ...draft, action: "ready_for_review" }).type).toBe(
      "pull_request",
    );
  });

  it("ignores a malformed payload instead of throwing", () => {
    expect(parseWebhook("pull_request", { action: "opened" }).type).toBe("ignored");
  });
});

describe("parseWebhook — push and installation", () => {
  const push = {
    ref: "refs/heads/main",
    after: "c".repeat(40),
    before: "d".repeat(40),
    repository: { name: "api", owner: { login: "acme" } },
    installation: { id: 987 },
  };

  it("normalizes a push", () => {
    const result = parseWebhook("push", push);
    expect(result.type).toBe("push");
    if (result.type !== "push") return;
    expect(result.target).toMatchObject({ owner: "acme", repo: "api", ref: "refs/heads/main" });
  });

  it("ignores branch deletions (zero SHA)", () => {
    expect(parseWebhook("push", { ...push, after: "0".repeat(40) }).type).toBe("ignored");
  });

  it("normalizes installation events", () => {
    const result = parseWebhook("installation", {
      action: "created",
      installation: { id: 555, account: { login: "acme" } },
    });
    expect(result.type).toBe("installation");
    if (result.type !== "installation") return;
    expect(result.change).toEqual({ installationId: 555, account: "acme", action: "created" });
  });

  it("ignores unsupported events", () => {
    const result = parseWebhook("star", {});
    expect(result.type).toBe("ignored");
    if (result.type !== "ignored") return;
    expect(result.reason).toContain("unsupported event");
  });
});
