import { describe, expect, it } from "vitest";
import { getManifestJsonSchema, JSON_SCHEMA_ID } from "../src/jsonschema.js";
import { SPEC_VERSION, isSupportedSpecVersion, parseSemVer } from "../src/version.js";

describe("jsonschema", () => {
  it("generates an object schema with the manifest's required fields", () => {
    const schema = getManifestJsonSchema();
    expect(schema.type).toBe("object");
    const required = schema.required as string[];
    expect(required).toContain("specVersion");
    expect(required).toContain("evidenceHash");
    expect(required).toContain("risk");
  });

  it("pins the schema id to the current spec version", () => {
    expect(JSON_SCHEMA_ID).toContain(SPEC_VERSION);
  });
});

describe("version", () => {
  it("parses semver", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer("nope")).toBeNull();
  });

  it("supports major 1, rejects major 2", () => {
    expect(isSupportedSpecVersion("1.9.9")).toBe(true);
    expect(isSupportedSpecVersion("2.0.0")).toBe(false);
  });
});
