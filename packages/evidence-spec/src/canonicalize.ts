/**
 * Deterministic JSON canonicalization.
 *
 * ProofForge hashes are computed over a canonical serialization so that any two
 * machines produce byte-identical output for semantically equal manifests. The
 * scheme follows the essentials of RFC 8785 (JSON Canonicalization Scheme):
 *
 *   - object keys are sorted lexicographically by UTF-16 code unit;
 *   - no insignificant whitespace;
 *   - arrays keep their order;
 *   - only finite numbers are allowed (NaN/Infinity are rejected);
 *   - `undefined` object properties are dropped (as JSON.stringify does).
 *
 * Number formatting relies on ECMAScript's `Number.prototype.toString`, which is
 * deterministic across conformant engines. Manifests should keep numeric values
 * to integers and short decimals to avoid ambiguity — enforced by the schema.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";

  const type = typeof value;

  if (type === "boolean") return value ? "true" : "false";

  if (type === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new CanonicalizationError(`Non-finite number cannot be canonicalized: ${String(n)}`);
    }
    return JSON.stringify(n);
  }

  if (type === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeValue(item ?? null)).join(",")}]`;
  }

  if (type === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(record[key])}`);
    return `{${members.join(",")}}`;
  }

  throw new CanonicalizationError(`Unsupported value of type "${type}" in canonicalization`);
}

export class CanonicalizationError extends Error {
  override readonly name = "CanonicalizationError";
}

/** Produce the canonical JSON string for a JSON-compatible value. */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value);
}
