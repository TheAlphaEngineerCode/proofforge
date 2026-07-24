/**
 * Drives an analysis through the state machine, persisting each transition and
 * publishing events for the SSE stream. At the evidence-generation step it
 * builds a real, schema-valid proof-manifest and stores an evidence bundle.
 *
 * This is the in-process orchestrator for Phase 4. A distributed worker (Phase 8)
 * will run the same state machine off a queue; the interface stays the same.
 */
import { randomUUID } from "node:crypto";
import type { Storage } from "@proofforge/database";
import { redact, type Metrics } from "@proofforge/observability";
import {
  canTransition,
  EVENT_SCHEMA_VERSION,
  type AnalysisStatus,
  type EventPublisher,
  type RiskLevel,
} from "@proofforge/shared-types";
import type { Manifest } from "@proofforge/evidence-spec";
import { buildAnalysisManifest } from "../manifest.js";
import {
  ANALYSES_TOTAL,
  ANALYSIS_DURATION,
  COLLECTOR_DURATION,
  COLLECTORS_TOTAL,
} from "../observability.js";
import type { RepositoryCheckout } from "./checkout.js";
import type { EvidenceProducer } from "./evidence-producer.js";
import type { PolicyGate } from "./policy-gate.js";

/**
 * Real evidence collection: check the commit out, then run the engine over it.
 * Absent when neither is configured, in which case a simulated manifest is used.
 */
export interface EvidencePipeline {
  checkout: RepositoryCheckout;
  producer: EvidenceProducer;
}

export interface RunnerLogger {
  warn(message: string): void;
}

// The validation-mode pipeline: no planning/implementation (those are agent mode).
const PIPELINE: readonly AnalysisStatus[] = [
  "REPOSITORY_ANALYSIS_PENDING",
  "REPOSITORY_ANALYSIS_RUNNING",
  "TESTING",
  "SECURITY_ANALYSIS",
  "PERFORMANCE_ANALYSIS",
  "EVIDENCE_GENERATION",
  "POLICY_VALIDATION",
];
// The terminal state is not fixed: the policy decides whether a change is
// approved, rejected, or handed to a human.

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export class AnalysisRunner {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: Storage,
    private readonly events: EventPublisher,
    private readonly stepMs: number,
    private readonly evidence?: EvidencePipeline,
    private readonly logger: RunnerLogger = { warn: (message) => console.warn(message) },
    private readonly policyGate?: PolicyGate,
    private readonly metrics?: Metrics,
  ) {}

  /** Start the pipeline for an analysis. Returns a promise that resolves when it ends. */
  start(analysisId: string): Promise<void> {
    const promise = this.execute(analysisId).finally(() => this.inflight.delete(analysisId));
    this.inflight.set(analysisId, promise);
    return promise;
  }

  /** Await an in-flight run (used by tests); resolves immediately if none. */
  wait(analysisId: string): Promise<void> {
    return this.inflight.get(analysisId) ?? Promise.resolve();
  }

  private async execute(analysisId: string): Promise<void> {
    let previous: AnalysisStatus = "CREATED";
    const startedAt = Date.now();
    try {
      const analysis = await this.storage.getAnalysis(analysisId);
      if (!analysis) throw new Error(`analysis not found: ${analysisId}`);
      const repository = await this.storage.getRepository(analysis.repositoryId);
      if (!repository) throw new Error(`repository not found: ${analysis.repositoryId}`);

      let manifest: Manifest | undefined;
      let finalStatus: AnalysisStatus = "WAITING_FOR_HUMAN_APPROVAL";

      for (const status of PIPELINE) {
        await sleep(this.stepMs);
        if (!canTransition(previous, status)) {
          throw new Error(`illegal transition ${previous} -> ${status}`);
        }

        if (status === "EVIDENCE_GENERATION") {
          manifest = await this.produceManifest(repository.owner, repository.name, {
            commit: analysis.commitSha,
            branch: repository.defaultBranch,
          });
          this.recordCollectors(manifest);
        }

        if (status === "POLICY_VALIDATION") {
          // Reaching here without a manifest means evidence generation was
          // skipped, which would silently leave the analysis with no bundle.
          if (manifest === undefined) {
            throw new Error("reached policy validation with no manifest to evaluate");
          }
          // The policy writes its outcomes into the manifest, so the bundle is
          // persisted only after this — one write, and a hash that matches.
          finalStatus = await this.applyPolicy(analysisId, repository.organizationId, manifest);
          await this.persistBundle(analysisId, manifest, analysis.commitSha);
        }

        await this.storage.updateAnalysis(analysisId, { status });
        this.publishStatus(analysisId, status, previous);
        previous = status;
      }

      await sleep(this.stepMs);
      if (!canTransition(previous, finalStatus)) {
        throw new Error(`illegal transition ${previous} -> ${finalStatus}`);
      }
      await this.storage.updateAnalysis(analysisId, { status: finalStatus });
      this.publishStatus(analysisId, finalStatus, previous);

      const final = await this.storage.getAnalysis(analysisId);
      this.events.publish(analysisId, {
        version: EVENT_SCHEMA_VERSION,
        type: "completed",
        analysisId,
        status: finalStatus,
        riskScore: final?.riskScore ?? null,
        evidenceBundleId: final?.evidenceBundleId ?? null,
        at: new Date().toISOString(),
      });

      // Last, so a throw between here and the top of the try lands in the catch
      // and is counted once, as FAILED. Recording earlier would count the same
      // run twice under two different statuses, and the totals would then say
      // more analyses ran than ever existed.
      this.record(finalStatus, startedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record("FAILED", startedAt);
      await this.storage.updateAnalysis(analysisId, { status: "FAILED", error: message });
      this.events.publish(analysisId, {
        version: EVENT_SCHEMA_VERSION,
        type: "error",
        analysisId,
        message,
        at: new Date().toISOString(),
      });
    }
  }

  /** How the run ended and how long it took, as one pair so they cannot diverge. */
  private record(status: AnalysisStatus, startedAt: number): void {
    this.metrics?.increment(ANALYSES_TOTAL, { status });
    this.metrics?.observe(ANALYSIS_DURATION, (Date.now() - startedAt) / 1000, { status });
  }

  /**
   * The collector provenance, counted.
   *
   * The manifest already records which collectors ran; without this the fact is
   * true once per analysis and invisible across all of them, so a collector
   * that has been unavailable for a week reads as a week of clean results.
   */
  private recordCollectors(manifest: Manifest): void {
    if (this.metrics === undefined) return;
    for (const run of manifest.collectors) {
      this.metrics.increment(COLLECTORS_TOTAL, { collector: run.name, status: run.status });
      this.metrics.observe(COLLECTOR_DURATION, run.durationMs / 1000, { collector: run.name });
    }
  }

  /** Build the manifest. Persisting it waits until the policy has had its say. */
  private async produceManifest(
    owner: string,
    name: string,
    change: { commit: string; branch: string },
  ): Promise<Manifest> {
    const manifest =
      (await this.collectRealEvidence(owner, name, change)) ??
      buildAnalysisManifest({
        id: randomUUID(),
        owner,
        name,
        commit: change.commit,
        baseCommit: change.commit,
        branch: change.branch,
        // Interim placeholder risk; the engine supplies real scoring when available.
        riskScore: 18,
        riskLevel: "low",
      });

    return manifest;
  }

  /** Evaluate the org's policy against the manifest; returns the terminal state. */
  private async applyPolicy(
    analysisId: string,
    organizationId: string,
    manifest: Manifest,
  ): Promise<AnalysisStatus> {
    if (!this.policyGate) return "WAITING_FOR_HUMAN_APPROVAL";

    const { report, finalStatus } = await this.policyGate.apply(organizationId, manifest);
    if (report !== undefined) {
      const waived = report.warnings.filter((entry) => entry.waivedBy !== undefined);
      for (const outcome of waived) {
        // A waived rule is a decision someone made; it belongs in the audit trail.
        this.logger.warn(
          `[policy] ${analysisId}: rule ${outcome.rule} waived by ${outcome.waivedBy ?? "unknown"}`,
        );
      }
      if (report.decision === "blocked") {
        await this.storage.updateAnalysis(analysisId, { error: report.summary });
      }
    }
    return finalStatus;
  }

  private async persistBundle(
    analysisId: string,
    manifest: Manifest,
    commitSha: string,
  ): Promise<void> {
    const riskScore = manifest.risk.score;
    const riskLevel = manifest.risk.level as RiskLevel;

    const bundle = await this.storage.createEvidenceBundle({
      analysisId,
      commitSha,
      manifestVersion: manifest.specVersion,
      riskScore,
      evidenceHash: manifest.evidenceHash,
      manifest,
    });

    await this.storage.updateAnalysis(analysisId, {
      evidenceBundleId: bundle.id,
      riskScore,
      riskLevel,
    });
  }

  private publishStatus(
    analysisId: string,
    status: AnalysisStatus,
    previous: AnalysisStatus,
  ): void {
    this.events.publish(analysisId, {
      version: EVENT_SCHEMA_VERSION,
      type: "status",
      analysisId,
      status,
      previousStatus: previous,
      at: new Date().toISOString(),
    });
  }

  /**
   * Check the commit out and run the evidence engine over it. Any failure here —
   * unreachable repository, missing engine, timeout — degrades to the simulated
   * manifest instead of losing the analysis.
   */
  private async collectRealEvidence(
    owner: string,
    name: string,
    change: { commit: string; branch: string },
  ): Promise<Manifest | null> {
    const pipeline = this.evidence;
    if (!pipeline) return null;

    let checkout: Awaited<ReturnType<RepositoryCheckout["fetch"]>> | undefined;
    try {
      checkout = await pipeline.checkout.fetch({
        owner,
        repo: name,
        commitSha: change.commit,
      });
      return await pipeline.producer.produce({
        repoPath: checkout.path,
        owner,
        name,
        commitSha: change.commit,
        baseSha: change.commit,
        branch: change.branch,
      });
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[evidence] falling back to a simulated manifest for ${owner}/${name}@${change.commit.slice(0, 7)}: ${message}`,
      );
      return null;
    } finally {
      await checkout?.dispose();
    }
  }
}
