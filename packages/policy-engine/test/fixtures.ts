import { ManifestSchema, computeEvidenceHash, type Manifest } from "@proofforge/evidence-spec";

const ALL_COLLECTORS = ["tests", "coverage", "secrets", "sast", "vulnerabilities", "sbom"];

/** A clean manifest where every collector ran; override per test. */
export function buildManifest(overrides: Partial<Manifest> = {}): Manifest {
  const manifest = ManifestSchema.parse({
    specVersion: "1.1.0",
    id: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
    repository: {
      provider: "github",
      owner: "acme",
      name: "api",
      url: "https://github.com/acme/api",
    },
    change: {
      commit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      baseCommit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      branch: "feature/x",
      title: "Change",
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
      passed: 40,
      failed: 0,
      skipped: 0,
      durationMs: 1200,
      coverage: { total: 92, changedLines: 90 },
    },
    security: {
      criticalVulnerabilities: 0,
      highVulnerabilities: 0,
      mediumVulnerabilities: 0,
      lowVulnerabilities: 0,
      secretsDetected: 0,
      sbomGenerated: true,
    },
    quality: { complexityBefore: 5, complexityAfter: 5, duplicatedLinesPercentage: 0 },
    performance: { benchmarks: [] },
    operations: {
      migrationsDetected: false,
      migrationsReversible: true,
      rollbackAvailable: true,
      downtimeRequired: false,
    },
    risk: { score: 12, level: "low", categories: {}, reasons: [] },
    policies: {},
    collectors: ALL_COLLECTORS.map((name) => ({
      name,
      status: "ok" as const,
      detail: "",
      durationMs: 10,
    })),
    evidenceHash: `sha256:${"0".repeat(64)}`,
    signature: { algorithm: "ed25519", publicKeyId: "", value: "" },
    createdAt: "2026-07-19T12:00:00.000Z",
    ...overrides,
  });
  manifest.evidenceHash = computeEvidenceHash(manifest);
  return manifest;
}
