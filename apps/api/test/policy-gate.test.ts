import { InMemoryStorage } from "@proofforge/database";
import { ManifestSchema, computeEvidenceHash, type Manifest } from "@proofforge/evidence-spec";
import { describe, expect, it } from "vitest";
import { EventBus } from "../src/events.js";
import { AnalysisRunner } from "../src/services/analysis-runner.js";
import { PolicyGate } from "../src/services/policy-gate.js";

const silent = { warn: () => {} };

const CLEAN_POLICY = `
version: "1.0"
name: permissive
onUnverifiable: warn
risk:
  maxAutomaticApprovalScore: 90
`;

const BLOCKING_POLICY = `
version: "1.0"
name: blocking
onUnverifiable: fail
security:
  maxCriticalVulnerabilities: 0
`;

const HUMAN_POLICY = `
version: "1.0"
name: cautious
onUnverifiable: warn
risk:
  maxAutomaticApprovalScore: 1
`;

async function seed(storage: InMemoryStorage, policyContent?: string) {
  const user = await storage.createUser({ name: "u", email: "u@example.com" });
  const org = await storage.createOrganization({ name: "o", slug: "o", ownerId: user.id });
  const repo = await storage.createRepository({
    organizationId: org.id,
    owner: "acme",
    name: "api",
    defaultBranch: "main",
    language: null,
    private: false,
  });
  if (policyContent !== undefined) {
    await storage.createPolicy({
      organizationId: org.id,
      name: "active",
      version: "1.0",
      content: policyContent,
      active: true,
    });
  }
  const analysis = await storage.createAnalysis({
    repositoryId: repo.id,
    commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
  });
  return { orgId: org.id, analysisId: analysis.id };
}

async function runWithPolicy(policyContent?: string) {
  const storage = new InMemoryStorage();
  const { analysisId } = await seed(storage, policyContent);
  const runner = new AnalysisRunner(
    storage,
    new EventBus(),
    0,
    undefined,
    silent,
    new PolicyGate(storage, silent),
  );
  await runner.start(analysisId);

  const analysis = await storage.getAnalysis(analysisId);
  const manifest = (await storage.getManifest(analysis?.evidenceBundleId ?? "")) as Manifest;
  return { analysis, manifest };
}

describe("policy in the pipeline", () => {
  it("approves outright when the policy is satisfied", async () => {
    const { analysis } = await runWithPolicy(CLEAN_POLICY);
    expect(analysis?.status).toBe("APPROVED");
  });

  it("asks for a human when risk is above the automatic threshold", async () => {
    const { analysis } = await runWithPolicy(HUMAN_POLICY);
    expect(analysis?.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
  });

  it("rejects when a rule cannot be satisfied, recording why", async () => {
    const { analysis } = await runWithPolicy(BLOCKING_POLICY);
    expect(analysis?.status).toBe("REJECTED");
    expect(analysis?.error).toContain("policy rules failed");
  });

  it("falls back to human review when no policy is configured", async () => {
    const { analysis } = await runWithPolicy(undefined);
    expect(analysis?.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
  });

  it("stores the outcomes in the manifest with a hash that still matches", async () => {
    const { manifest } = await runWithPolicy(BLOCKING_POLICY);

    expect(manifest.policies.failed.length).toBeGreaterThan(0);
    // The policy rewrote the document, so the hash must have been stamped again.
    expect(computeEvidenceHash(manifest)).toBe(manifest.evidenceHash);
    expect(() => ManifestSchema.parse(manifest)).not.toThrow();
  });

  it("does not approve on a policy it cannot parse", async () => {
    const { analysis } = await runWithPolicy("version: [broken");
    expect(analysis?.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
  });
});
