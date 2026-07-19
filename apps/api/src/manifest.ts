/**
 * Builds a schema-valid proof-manifest for an analysis using the canonical
 * evidence-spec (same schema and hashing as the CLI and the Python engine).
 *
 * The evidence values here are placeholders for the API's simulated pipeline;
 * real values arrive when the orchestrator wires the Python evidence engine.
 * The manifest itself — schema, hash, structure — is fully real and verifiable.
 */
import {
  ManifestSchema,
  computeEvidenceHash,
  SPEC_VERSION,
  type Manifest,
  type ManifestInput,
} from "@proofforge/evidence-spec";
import type { RiskLevel } from "@proofforge/shared-types";

export interface AnalysisManifestParams {
  id: string;
  owner: string;
  name: string;
  commit: string;
  baseCommit: string;
  branch: string;
  riskScore: number;
  riskLevel: RiskLevel;
}

export function buildAnalysisManifest(params: AnalysisManifestParams): Manifest {
  const input: ManifestInput = {
    specVersion: SPEC_VERSION,
    id: params.id,
    repository: {
      provider: "github",
      owner: params.owner,
      name: params.name,
      url: `https://github.com/${params.owner}/${params.name}`,
    },
    change: {
      commit: params.commit,
      baseCommit: params.baseCommit,
      branch: params.branch,
      title: `Analysis of ${params.commit.slice(0, 7)}`,
      request: "",
      type: "validation",
    },
    environment: {
      runnerVersion: "0.1.0",
      operatingSystem: "linux",
      containerImage: "",
      runtimeVersions: {},
      dependencyLockHashes: {},
    },
    tests: {
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      coverage: { total: 0, changedLines: 0 },
    },
    security: {
      criticalVulnerabilities: 0,
      highVulnerabilities: 0,
      mediumVulnerabilities: 0,
      lowVulnerabilities: 0,
      secretsDetected: 0,
      sbomGenerated: false,
    },
    quality: {
      complexityBefore: 0,
      complexityAfter: 0,
      duplicatedLinesPercentage: 0,
    },
    performance: { benchmarks: [] },
    operations: {
      migrationsDetected: false,
      migrationsReversible: true,
      rollbackAvailable: true,
      downtimeRequired: false,
    },
    risk: {
      score: params.riskScore,
      level: params.riskLevel,
      categories: {},
      reasons: ["Simulated API pipeline; evidence engine wiring lands in a later phase."],
    },
    policies: {},
    evidenceHash: `sha256:${"0".repeat(64)}`,
    signature: { algorithm: "ed25519", publicKeyId: "", value: "" },
    createdAt: new Date().toISOString(),
  };

  const manifest = ManifestSchema.parse(input);
  manifest.evidenceHash = computeEvidenceHash(manifest);
  return manifest;
}
