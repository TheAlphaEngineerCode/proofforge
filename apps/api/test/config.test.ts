import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("forces dev-login off in production even if the env enables it", () => {
    const config = loadConfig({ NODE_ENV: "production", AUTH_DEV_LOGIN: "true" });
    expect(config.devLogin).toBe(false);
  });

  it("allows dev-login in development", () => {
    const config = loadConfig({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    expect(config.devLogin).toBe(true);
  });

  it("turns dev-login off when asked to, in every spelling of no", () => {
    // `Boolean("false")` is true, so a coercing parse would leave a
    // credential-free login open on a shared development deployment.
    for (const off of ["false", "FALSE", "0", "no", "off", " false "]) {
      expect(loadConfig({ NODE_ENV: "development", AUTH_DEV_LOGIN: off }).devLogin).toBe(false);
    }
    for (const on of ["true", "1", "yes", undefined]) {
      expect(loadConfig({ NODE_ENV: "development", AUTH_DEV_LOGIN: on }).devLogin).toBe(true);
    }
  });

  it("applies sane defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3001);
    expect(config.webOrigin).toBe("http://localhost:3000");
  });

  const OAUTH = { GITHUB_APP_CLIENT_ID: "Iv1.x", GITHUB_APP_CLIENT_SECRET: "s" };

  it("refuses to start OAuth in production without a shared state secret", () => {
    expect(() => loadConfig({ NODE_ENV: "production", ...OAUTH })).toThrow(/AUTH_STATE_SECRET/);
  });

  it("starts in production without OAuth, which simply leaves it disabled", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).not.toThrow();
  });

  it("invents a state secret locally, where one process is all there is", () => {
    const config = loadConfig({ NODE_ENV: "development", ...OAUTH });
    expect(config.authStateSecret).toHaveLength(64);
    expect(loadConfig({ NODE_ENV: "development" }).authStateSecret).not.toBe(
      config.authStateSecret,
    );
  });

  it("keeps the state secret it was given", () => {
    const config = loadConfig({ NODE_ENV: "production", ...OAUTH, AUTH_STATE_SECRET: "shared" });
    expect(config.authStateSecret).toBe("shared");
  });
});
