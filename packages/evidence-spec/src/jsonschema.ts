/**
 * JSON Schema generation.
 *
 * The JSON Schema is derived from the canonical Zod schema so external consumers
 * (CI gates, other languages) can validate manifests without a JS runtime, while
 * ProofForge keeps a single source of truth.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { ManifestSchema } from "./schema.js";
import { SPEC_VERSION } from "./version.js";

export function getManifestJsonSchema(): Record<string, unknown> {
  // No `name` option: that would wrap the schema in a `$ref` + `definitions`
  // envelope. We want the object schema inlined at the root so `type` and
  // `required` sit at the top level.
  return zodToJsonSchema(ManifestSchema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
}

export const JSON_SCHEMA_ID = `https://proofforge.dev/schema/proof-manifest/${SPEC_VERSION}.json`;
