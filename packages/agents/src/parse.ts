/**
 * Reading a JSON reply out of a model's text.
 *
 * Models wrap answers in code fences and explain themselves first, and the prose
 * may contain braces of its own — a sentence quoting `if (x) { return true; }`
 * reads as an object and parses as nothing. So every balanced span is tried and
 * the first one that validates against the schema wins, rather than betting the
 * first brace in the text opens the answer.
 */

import type { z } from "zod";

export type ParsedReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export function parseJsonReply<S extends z.ZodTypeAny>(
  text: string,
  schema: S,
  what: string,
): ParsedReply<z.output<S>> {
  const candidates = [...balancedObjects(text)];
  if (candidates.length === 0) {
    return { ok: false, reason: `the model's reply contained no JSON object` };
  }

  let lastSchemaError: string | null = null;

  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }

    const parsed = schema.safeParse(value);
    if (parsed.success) return { ok: true, value: parsed.data };

    lastSchemaError = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }

  return {
    ok: false,
    reason:
      lastSchemaError === null
        ? "the model's reply contained no valid JSON object"
        : `the model's reply did not match the ${what} schema: ${lastSchemaError}`,
  };
}

/** Every balanced `{...}` span in the text, outermost first. */
function* balancedObjects(text: string): Generator<string> {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = matchingBrace(text, start);
    if (end !== null) yield text.slice(start, end + 1);
  }
}

/** Quote and escape tracking keeps a brace inside a string from closing early. */
function matchingBrace(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return null;
}
