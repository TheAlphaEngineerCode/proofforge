import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  STATE_TTL_MS,
  authorizeUrl,
  bindingMatches,
  createState,
  exchangeCodeForToken,
  fetchIdentity,
  verifyState,
} from "../src/oauth.js";

const SECRET = "state-signing-secret";
const NOW = 1_800_000_000_000;

describe("state", () => {
  it("round-trips the redirect it was given", () => {
    const state = createState(SECRET, "/repositories/42", NOW);
    expect(verifyState(SECRET, state.value, NOW)?.redirectTo).toBe("/repositories/42");
  });

  it("gives two states for the same input, so neither can be replayed", () => {
    expect(createState(SECRET, "/dashboard", NOW).value).not.toBe(
      createState(SECRET, "/dashboard", NOW).value,
    );
  });

  it("hands back the nonce the caller has to give the browser", () => {
    const state = createState(SECRET, "/dashboard", NOW);
    expect(verifyState(SECRET, state.value, NOW)?.nonce).toBe(state.nonce);
  });

  it("rejects a redirect rewritten in flight", () => {
    const state = createState(SECRET, "/dashboard", NOW);
    const tampered = `${Buffer.from(
      JSON.stringify({ redirectTo: "//evil.example", nonce: "x", expiresAtMs: NOW + 1000 }),
      "utf8",
    ).toString("base64url")}.${state.value.split(".")[1]}`;

    expect(verifyState(SECRET, tampered, NOW)).toBeNull();
  });

  it("rejects a state signed with another key", () => {
    const state = createState("another-secret", "/dashboard", NOW);
    expect(verifyState(SECRET, state.value, NOW)).toBeNull();
  });

  it("expires", () => {
    const state = createState(SECRET, "/dashboard", NOW);
    expect(verifyState(SECRET, state.value, NOW + STATE_TTL_MS - 1)).not.toBeNull();
    expect(verifyState(SECRET, state.value, NOW + STATE_TTL_MS)).toBeNull();
  });

  it("rejects malformed input instead of throwing", () => {
    for (const input of ["", ".", "no-separator", "a.b", `${"x".repeat(40)}.zzzz`]) {
      expect(verifyState(SECRET, input, NOW)).toBeNull();
    }
  });

  it("rejects a payload missing a field, even correctly signed", () => {
    // Our own signature is not enough: what survives here goes straight into
    // bindingMatches, and a payload without a nonce would fail there as a crash
    // rather than as a refused login.
    for (const payload of [
      { redirectTo: "/dashboard", expiresAtMs: NOW + 1000 },
      { redirectTo: "/dashboard", nonce: "", expiresAtMs: NOW + 1000 },
      { nonce: "n", expiresAtMs: NOW + 1000 },
      { redirectTo: "/dashboard", nonce: "n" },
    ]) {
      const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const signature = createHmac("sha256", SECRET).update(body).digest("base64url");
      expect(verifyState(SECRET, `${body}.${signature}`, NOW)).toBeNull();
    }
  });
});

describe("binding a login to the browser that started it", () => {
  const payload = { redirectTo: "/dashboard", nonce: "the-nonce", expiresAtMs: NOW + 1000 };

  it("accepts the nonce that was issued", () => {
    expect(bindingMatches(payload, "the-nonce")).toBe(true);
  });

  it("refuses a callback with no cookie at all", () => {
    // The case that matters: a link captured from someone else's login arrives
    // at a browser that never started one here.
    expect(bindingMatches(payload, undefined)).toBe(false);
    expect(bindingMatches(payload, "")).toBe(false);
  });

  it("refuses a nonce from a different login", () => {
    expect(bindingMatches(payload, "other-nonce")).toBe(false);
    expect(bindingMatches(payload, "the-nonce-longer")).toBe(false);
    expect(bindingMatches(payload, "the-nonc")).toBe(false);
  });
});

describe("authorizeUrl", () => {
  it("carries the client, callback, state and scopes", () => {
    const url = new URL(
      authorizeUrl({
        clientId: "Iv1.abc",
        redirectUri: "https://api.example/api/v1/auth/github/callback",
        state: "state-value",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example/api/v1/auth/github/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });

  it("can be pointed at another host", () => {
    const url = authorizeUrl({
      clientId: "id",
      redirectUri: "http://localhost:3001/cb",
      state: "s",
      oauthBaseUrl: "http://localhost:9999",
    });
    expect(url.startsWith("http://localhost:9999/login/oauth/authorize")).toBe(true);
  });
});

describe("exchangeCodeForToken", () => {
  function exchange(fetchImpl: ReturnType<typeof vi.fn>) {
    return exchangeCodeForToken({
      clientId: "Iv1.abc",
      clientSecret: "shhh",
      code: "the-code",
      redirectUri: "https://api.example/cb",
      fetchImpl: fetchImpl as never,
    });
  }

  it("returns the access token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "gho_token" }),
    });

    expect(await exchange(fetchImpl)).toBe("gho_token");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://github.com/login/oauth/access_token");
    const request = init as { method: string; headers: Record<string, string>; body: string };
    expect(request.method).toBe("POST");
    expect(request.headers.accept).toBe("application/json");
    expect(JSON.parse(request.body).code).toBe("the-code");
  });

  it("treats GitHub's 200-with-an-error as the failure it is", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: "bad_verification_code" }),
    });
    await expect(exchange(fetchImpl)).rejects.toThrow(/bad_verification_code/);
  });

  it("fails when the response carries no token at all", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(exchange(fetchImpl)).rejects.toThrow(/no access token/);
  });

  it("never puts the client secret in the error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(exchange(fetchImpl)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("shhh") }) as Error,
    );
  });
});

describe("fetchIdentity", () => {
  function ok(body: unknown) {
    return { ok: true, status: 200, json: async () => body };
  }

  const PROFILE = {
    id: 4242,
    login: "octocat",
    name: "The Octocat",
    email: "octocat@example.com",
    avatar_url: "https://avatars.example/octocat.png",
  };

  it("normalizes the profile, keeping the numeric id as the handle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(PROFILE));

    expect(await fetchIdentity("gho_token", { fetchImpl: fetchImpl as never })).toEqual({
      id: "4242",
      login: "octocat",
      name: "The Octocat",
      email: "octocat@example.com",
      avatarUrl: "https://avatars.example/octocat.png",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/user");
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe(
      "Bearer gho_token",
    );
  });

  it("falls back to the primary verified address when the profile hides it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ ...PROFILE, email: null }))
      .mockResolvedValueOnce(
        ok([
          { email: "old@example.com", primary: false, verified: true },
          { email: "primary@example.com", primary: true, verified: true },
        ]),
      );

    const identity = await fetchIdentity("gho_token", { fetchImpl: fetchImpl as never });
    expect(identity.email).toBe("primary@example.com");
    expect(fetchImpl.mock.calls[1]![0]).toBe("https://api.github.com/user/emails");
  });

  it("ignores unverified addresses, which prove nothing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ ...PROFILE, email: null }))
      .mockResolvedValueOnce(
        ok([{ email: "unverified@example.com", primary: true, verified: false }]),
      );

    expect((await fetchIdentity("t", { fetchImpl: fetchImpl as never })).email).toBeNull();
  });

  it("signs the user in without an email rather than failing on the email lookup", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ ...PROFILE, email: null }))
      .mockRejectedValueOnce(new Error("network"));

    const identity = await fetchIdentity("t", { fetchImpl: fetchImpl as never });
    expect(identity.login).toBe("octocat");
    expect(identity.email).toBeNull();
  });

  it("fails when the token itself is not accepted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(fetchIdentity("t", { fetchImpl: fetchImpl as never })).rejects.toThrow(/401/);
  });

  it("refuses a 200 that carries no usable identity", async () => {
    // Otherwise the account is keyed on the string "undefined", and the failure
    // survives as data instead of as an error.
    for (const body of [{}, { id: 1 }, { login: "octocat" }, { id: "4242", login: "octocat" }]) {
      const fetchImpl = vi.fn().mockResolvedValue(ok(body));
      await expect(fetchIdentity("t", { fetchImpl: fetchImpl as never })).rejects.toThrow(
        /no usable identity/,
      );
    }
  });
});
