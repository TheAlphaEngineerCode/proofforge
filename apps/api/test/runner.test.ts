import { InMemoryStorage } from "@proofforge/database";
import type { AnalysisEvent } from "@proofforge/shared-types";
import { describe, expect, it } from "vitest";
import { EventBus } from "../src/events.js";
import { AnalysisRunner } from "../src/services/analysis-runner.js";

async function seedAnalysis(storage: InMemoryStorage): Promise<string> {
  const user = await storage.createUser({ name: "u", email: "u@x.com" });
  const org = await storage.createOrganization({ name: "o", slug: "o", ownerId: user.id });
  const repo = await storage.createRepository({
    organizationId: org.id,
    owner: "acme",
    name: "api",
    defaultBranch: "main",
    language: null,
    private: false,
  });
  const analysis = await storage.createAnalysis({ repositoryId: repo.id, commitSha: "abcdef1234567" });
  return analysis.id;
}

describe("AnalysisRunner", () => {
  it("emits ordered status events and a completed event", async () => {
    const storage = new InMemoryStorage();
    const events = new EventBus();
    const runner = new AnalysisRunner(storage, events, 0);
    const analysisId = await seedAnalysis(storage);

    const received: AnalysisEvent[] = [];
    events.subscribe(analysisId, (e) => received.push(e));

    await runner.start(analysisId);

    const statuses = received.filter((e) => e.type === "status").map((e) => e.status);
    expect(statuses).toEqual([
      "REPOSITORY_ANALYSIS_PENDING",
      "REPOSITORY_ANALYSIS_RUNNING",
      "TESTING",
      "SECURITY_ANALYSIS",
      "PERFORMANCE_ANALYSIS",
      "EVIDENCE_GENERATION",
      "POLICY_VALIDATION",
      "WAITING_FOR_HUMAN_APPROVAL",
    ]);

    const completed = received.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect(completed?.type === "completed" && completed.evidenceBundleId).toBeTruthy();
  });

  it("persists a bundle and risk on the analysis", async () => {
    const storage = new InMemoryStorage();
    const runner = new AnalysisRunner(storage, new EventBus(), 0);
    const analysisId = await seedAnalysis(storage);

    await runner.start(analysisId);

    const analysis = await storage.getAnalysis(analysisId);
    expect(analysis?.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
    expect(analysis?.riskScore).toBe(18);
    expect(analysis?.evidenceBundleId).toBeTruthy();

    const bundle = await storage.getEvidenceBundle(analysis?.evidenceBundleId ?? "");
    expect(bundle?.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("marks the analysis FAILED when the repository is missing", async () => {
    const storage = new InMemoryStorage();
    const events = new EventBus();
    const runner = new AnalysisRunner(storage, events, 0);
    // create an analysis pointing at a non-existent repository
    const analysis = await storage.createAnalysis({
      repositoryId: "00000000-0000-4000-8000-000000000000",
      commitSha: "abcdef1234567",
    });

    const received: AnalysisEvent[] = [];
    events.subscribe(analysis.id, (e) => received.push(e));
    await runner.start(analysis.id);

    expect((await storage.getAnalysis(analysis.id))?.status).toBe("FAILED");
    expect(received.some((e) => e.type === "error")).toBe(true);
  });
});
