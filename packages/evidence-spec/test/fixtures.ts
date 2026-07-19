import { computeEvidenceHash } from "../src/hash.js";
import { ManifestSchema, type Manifest, type ManifestInput } from "../src/schema.js";
import { SPEC_VERSION } from "../src/version.js";

/** A minimal but structurally complete manifest input for tests. */
export function baseManifestInput(): ManifestInput {
  return {
    specVersion: SPEC_VERSION,
    id: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
    repository: {
      provider: "github",
      owner: "proofforge",
      name: "example",
      url: "https://github.com/proofforge/example",
    },
    change: {
      commit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      baseCommit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      branch: "feature/example",
      pullRequest: 42,
      title: "Example change",
      request: "Do the thing",
      type: "agent",
    },
    environment: {
      runnerVersion: "0.1.0",
      operatingSystem: "linux",
      containerImage: "image@sha256:abc",
      runtimeVersions: { node: "20.11.0" },
      dependencyLockHashes: { "pnpm-lock.yaml": "sha256:aa11" },
    },
    tests: {
      passed: 10,
      failed: 0,
      skipped: 0,
      durationMs: 100,
      coverage: { total: 90, changedLines: 95 },
    },
    security: {
      criticalVulnerabilities: 0,
      highVulnerabilities: 0,
      mediumVulnerabilities: 0,
      lowVulnerabilities: 0,
      secretsDetected: 0,
      sbomGenerated: true,
    },
    quality: {
      complexityBefore: 1,
      complexityAfter: 1,
      duplicatedLinesPercentage: 0,
    },
    performance: { benchmarks: [] },
    operations: {
      migrationsDetected: false,
      migrationsReversible: true,
      rollbackAvailable: true,
      downtimeRequired: false,
    },
    risk: { score: 20, level: "low" },
    policies: {},
    evidenceHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    signature: { algorithm: "ed25519", publicKeyId: "", value: "" },
    createdAt: "2026-07-18T12:00:00.000Z",
  };
}

/** A fully valid, self-consistent manifest (correct evidence hash). */
export function validManifest(): Manifest {
  const parsed = ManifestSchema.parse(baseManifestInput());
  parsed.evidenceHash = computeEvidenceHash(parsed);
  return parsed;
}
