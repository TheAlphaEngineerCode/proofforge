import { describe, expect, it } from "vitest";
import { canonicalize, CanonicalizationError } from "../src/canonicalize.js";

describe("canonicalize", () => {
  it("sorts object keys deterministically regardless of insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalize({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined properties like JSON does", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("emits null for undefined array items", () => {
    expect(canonicalize([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizationError);
  });

  it("escapes strings via JSON semantics", () => {
    expect(canonicalize('a"b\n')).toBe('"a\\"b\\n"');
  });

  it("rejects unsupported value types (bigint, function)", () => {
    expect(() => canonicalize(10n)).toThrow(CanonicalizationError);
    expect(() => canonicalize(() => 1)).toThrow(CanonicalizationError);
  });
});
