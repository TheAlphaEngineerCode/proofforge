/**
 * @proofforge/evidence-spec
 *
 * Canonical schema, deterministic hashing and signature verification for the
 * ProofForge proof-manifest. This package has no side effects and no I/O beyond
 * Node's crypto primitives, so it is safe to embed anywhere (CLI, API, workers).
 */
export {
  ManifestSchema,
  RiskLevel,
  ChangeType,
  type Manifest,
  type ManifestInput,
} from "./schema.js";

export {
  SPEC_VERSION,
  SUPPORTED_MAJOR_VERSIONS,
  parseSemVer,
  isSupportedSpecVersion,
  type SemVer,
} from "./version.js";

export { canonicalize, CanonicalizationError, type JsonValue } from "./canonicalize.js";

export {
  HASH_ALGORITHM,
  computeEvidenceHash,
  verifyEvidenceHash,
  stripHashFields,
  type HashVerification,
} from "./hash.js";

export {
  signEvidenceHash,
  verifySignature,
  type SignatureStatus,
  type SignatureVerification,
} from "./signature.js";

export { getManifestJsonSchema, JSON_SCHEMA_ID } from "./jsonschema.js";

export {
  validateManifestStructure,
  verifyManifest,
  type ValidationIssue,
  type StructuralResult,
  type VerifyOptions,
  type VerifyResult,
} from "./validate.js";
