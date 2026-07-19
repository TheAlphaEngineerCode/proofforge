/**
 * Emits schema/proof-manifest.schema.json from the canonical Zod schema.
 * Run via `pnpm --filter @proofforge/evidence-spec generate:schema`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getManifestJsonSchema, JSON_SCHEMA_ID } from "../src/jsonschema.js";
import { SPEC_VERSION } from "../src/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "../schema/proof-manifest.schema.json");

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: JSON_SCHEMA_ID,
  title: `ProofForge Proof Manifest ${SPEC_VERSION}`,
  ...getManifestJsonSchema(),
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Wrote ${outFile}`);
