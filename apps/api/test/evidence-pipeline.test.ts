import { InMemoryStorage } from "@proofforge/database";
import type { Manifest } from "@proofforge/evidence-spec";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/events.js";
import { AnalysisRunner, type EvidencePipeline } from "../src/services/analysis-runner.js";
import type { Checkout, CheckoutRequest, RepositoryCheckout } from "../src/services/checkout.js";
import type { EvidenceProducer, EvidenceRequest } from "../src/services/evidence-producer.js";
import { buildAnalysisManifest } from "../src/manifest.js";
import { createMetrics } from "../src/observability.js";

const silent = { warn: () => {} };

class FakeCheckout implements RepositoryCheckout {
  disposed = 0;
  constructor(private readonly failWith?: Error) {}

  async fetch(_request: CheckoutRequest): Promise<Checkout> {
    if (this.failWith) throw this.failWith;
    return {
      path: "/tmp/fake-checkout",
      dispose: async () => {
        this.disposed += 1;
      },
    };
  }
}

class FakeProducer implements EvidenceProducer {
  seen: EvidenceRequest[] = [];
  constructor(private readonly result: Manifest | Error) {}

  async produce(request: EvidenceRequest): Promise<Manifest | null> {
    this.seen.push(request);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

async function seed(storage: InMemoryStorage): Promise<string> {
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
  const analysis = await storage.createAnalysis({
    repositoryId: repo.id,
    commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
  });
  return analysis.id;
}

async function runWith(pipeline: EvidencePipeline | undefined) {
  const storage = new InMemoryStorage();
  const analysisId = await seed(storage);
  const runner = new AnalysisRunner(storage, new EventBus(), 0, pipeline, silent);
  await runner.start(analysisId);
  const analysis = await storage.getAnalysis(analysisId);
  const manifest = (await storage.getManifest(analysis!.evidenceBundleId!)) as Manifest;
  return { analysis, manifest, storage };
}

describe("evidence pipeline wiring", () => {
  it("uses the manifest produced by the engine, including its risk score", async () => {
    const produced = buildAnalysisManifest({
      id: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
      owner: "acme",
      name: "api",
      commit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      baseCommit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      branch: "main",
      riskScore: 63,
      riskLevel: "high",
    });
    const checkout = new FakeCheckout();
    const producer = new FakeProducer(produced);

    const { analysis, manifest } = await runWith({ checkout, producer });

    expect(analysis?.riskScore).toBe(63);
    expect(analysis?.riskLevel).toBe("high");
    expect(manifest.evidenceHash).toBe(produced.evidenceHash);
    expect(producer.seen[0]).toMatchObject({ owner: "acme", name: "api", branch: "main" });
    expect(checkout.disposed).toBe(1); // the working copy is always cleaned up
  });

  it("falls back to a simulated manifest when the engine fails", async () => {
    const checkout = new FakeCheckout();
    const producer = new FakeProducer(new Error("uv: command not found"));

    const { analysis, manifest } = await runWith({ checkout, producer });

    expect(analysis?.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
    expect(manifest.risk.reasons.join(" ")).toMatch(/simulated/i);
    expect(checkout.disposed).toBe(1);
  });

  it("falls back — and does not leak a checkout — when the clone fails", async () => {
    const checkout = new FakeCheckout(new Error("repository not found"));
    const producer = new FakeProducer(new Error("should not be reached"));

    const { analysis } = await runWith({ checkout, producer });

    expect(analysis?.status).toBe("WAITING_FOR_HUMAN_APPROVAL");
    expect(analysis?.evidenceBundleId).toBeTruthy();
    expect(producer.seen).toHaveLength(0);
    expect(checkout.disposed).toBe(0);
  });

  it("produces a simulated manifest when no pipeline is configured", async () => {
    const { analysis, manifest } = await runWith(undefined);
    expect(analysis?.riskScore).toBe(18);
    expect(manifest.risk.reasons.join(" ")).toMatch(/simulated/i);
  });

  it("counts each collector the engine reported, by status", async () => {
    // Only the real engine fills `collectors`, so this path is never reached by
    // the simulated manifest — which is how the wiring could go missing unseen.
    const produced = buildAnalysisManifest({
      id: "c4e2d3b5-6f70-4a81-9b02-3d4e5f6a7b8c",
      owner: "acme",
      name: "api",
      commit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      baseCommit: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      branch: "main",
      riskScore: 20,
      riskLevel: "low",
    });
    produced.collectors = [
      { name: "coverage", status: "ok", detail: "", durationMs: 1200 },
      { name: "sast", status: "unavailable", detail: "semgrep not installed", durationMs: 0 },
    ];

    const storage = new InMemoryStorage();
    const analysisId = await seed(storage);
    const metrics = createMetrics();
    const runner = new AnalysisRunner(
      storage,
      new EventBus(),
      0,
      { checkout: new FakeCheckout(), producer: new FakeProducer(produced) },
      silent,
      undefined,
      metrics,
    );

    await runner.start(analysisId);

    const exposed = metrics.render();
    expect(exposed).toContain('proofforge_collectors_total{collector="coverage",status="ok"} 1');
    // The one that matters: a collector that never ran must not read as clean.
    expect(exposed).toContain(
      'proofforge_collectors_total{collector="sast",status="unavailable"} 1',
    );
  });

  it("keeps the checkout token out of logs on failure", async () => {
    const warn = vi.fn();
    const storage = new InMemoryStorage();
    const analysisId = await seed(storage);
    const runner = new AnalysisRunner(
      storage,
      new EventBus(),
      0,
      {
        checkout: new FakeCheckout(new Error("fatal: x-access-token:ghs_supersecret@github.com bad")),
        producer: new FakeProducer(new Error("unused")),
      },
      { warn },
    );

    await runner.start(analysisId);

    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("ghs_supersecret");
  });
});
