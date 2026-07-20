import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDeps } from "../src/factory.js";
import type { AppDeps } from "../src/deps.js";

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
}

export async function setup(env: NodeJS.ProcessEnv = {}): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_DEV_LOGIN: "true",
    PIPELINE_STEP_MS: "0",
    ...env,
  });
  const deps = createDeps(config);
  const app = await buildApp(deps);
  return { app, deps };
}

export async function login(app: FastifyInstance): Promise<{ token: string; userId: string }> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/dev-login", payload: {} });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

// ── manifest fixture ─────────────────────────────────────────────────────────
import { ManifestSchema, computeEvidenceHash, type Manifest } from "@proofforge/evidence-spec";

/** Every collector ran: the default fixture is measured-and-clean, not unmeasured. */
const COLLECTORS_OK = ["tests", "coverage", "secrets", "sast", "vulnerabilities", "sbom"].map((name) => ({
  name,
  status: "ok" as const,
  detail: "",
  durationMs: 10,
}));

/** A schema-valid manifest with clean evidence; override fields per test. */
export function buildManifestFixture(overrides: Partial<Manifest> = {}): Manifest {
  const manifest = ManifestSchema.parse({
    specVersion: "1.1.0",
    collectors: COLLECTORS_OK,
    id: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
    repository: { provider: "github", owner: "acme", name: "api", url: "https://github.com/acme/api" },
    change: {
      commit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      baseCommit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      branch: "feature/x",
      pullRequest: 42,
      title: "Add OAuth",
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
      passed: 184,
      failed: 0,
      skipped: 2,
      durationMs: 12000,
      coverage: { total: 86.2, changedLines: 92.4 },
    },
    security: {
      criticalVulnerabilities: 0,
      highVulnerabilities: 0,
      mediumVulnerabilities: 0,
      lowVulnerabilities: 0,
      secretsDetected: 0,
      sbomGenerated: true,
    },
    quality: { complexityBefore: 10, complexityAfter: 11, duplicatedLinesPercentage: 1.2 },
    performance: { benchmarks: [] },
    operations: {
      migrationsDetected: false,
      migrationsReversible: true,
      rollbackAvailable: true,
      downtimeRequired: false,
    },
    risk: { score: 15, level: "low" },
    policies: {},
    evidenceHash: `sha256:${"0".repeat(64)}`,
    signature: { algorithm: "ed25519", publicKeyId: "", value: "" },
    createdAt: "2026-07-19T12:00:00.000Z",
  });

  const merged = { ...manifest, ...overrides } as Manifest;
  merged.evidenceHash = computeEvidenceHash(merged);
  return merged;
}
