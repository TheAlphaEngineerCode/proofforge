import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InstallationTokenProvider, createAppJwt } from "../src/auth.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("createAppJwt", () => {
  const NOW = 1_800_000_000_000;

  it("produces a verifiable RS256 JWT", () => {
    const jwt = createAppJwt("123456", PRIVATE_PEM, NOW);
    const [header, payload, signature] = jwt.split(".");

    expect(decodeSegment(header!)).toEqual({ alg: "RS256", typ: "JWT" });

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("backdates iat and keeps the lifetime under GitHub's 10 minute cap", () => {
    const claims = decodeSegment(createAppJwt("123456", PRIVATE_PEM, NOW).split(".")[1]!);
    const nowS = Math.floor(NOW / 1000);
    expect(claims.iss).toBe("123456");
    expect(claims.iat).toBe(nowS - 60);
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(600);
  });
});

describe("InstallationTokenProvider", () => {
  function provider(fetchImpl: ReturnType<typeof vi.fn>, now = () => 1_800_000_000_000) {
    return new InstallationTokenProvider({
      appId: "123456",
      privateKey: PRIVATE_PEM,
      fetchImpl: fetchImpl as never,
      now,
    });
  }

  function tokenResponse(token: string, expiresAtMs: number) {
    return {
      ok: true,
      status: 201,
      json: async () => ({ token, expires_at: new Date(expiresAtMs).toISOString() }),
    };
  }

  it("fetches a token and caches it across calls", async () => {
    const now = 1_800_000_000_000;
    const fetchImpl = vi.fn().mockResolvedValue(tokenResponse("tok-1", now + 3_600_000));
    const tokens = provider(fetchImpl, () => now);

    expect(await tokens.getToken(987)).toBe("tok-1");
    expect(await tokens.getToken(987)).toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/app/installations/987/access_tokens");
    expect((init as { method: string }).method).toBe("POST");
  });

  it("refreshes once the cached token is close to expiring", async () => {
    let now = 1_800_000_000_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-1", now + 30_000)) // expires very soon
      .mockResolvedValueOnce(tokenResponse("tok-2", now + 3_600_000));
    const tokens = provider(fetchImpl, () => now);

    expect(await tokens.getToken(987)).toBe("tok-1");
    now += 1_000;
    expect(await tokens.getToken(987)).toBe("tok-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps separate tokens per installation", async () => {
    const now = 1_800_000_000_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-a", now + 3_600_000))
      .mockResolvedValueOnce(tokenResponse("tok-b", now + 3_600_000));
    const tokens = provider(fetchImpl, () => now);

    expect(await tokens.getToken(1)).toBe("tok-a");
    expect(await tokens.getToken(2)).toBe("tok-b");
  });

  it("surfaces an error when GitHub rejects the exchange", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(provider(fetchImpl).getToken(987)).rejects.toThrow(/401/);
  });

  it("invalidate() forces a refetch", async () => {
    const now = 1_800_000_000_000;
    const fetchImpl = vi.fn().mockResolvedValue(tokenResponse("tok-1", now + 3_600_000));
    const tokens = provider(fetchImpl, () => now);

    await tokens.getToken(987);
    tokens.invalidate(987);
    await tokens.getToken(987);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
