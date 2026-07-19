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

  it("applies sane defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3001);
    expect(config.webOrigin).toBe("http://localhost:3000");
  });
});
