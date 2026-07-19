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
import {
  canTransition,
  EVENT_SCHEMA_VERSION,
  type AnalysisStatus,
  type RiskLevel,
} from "@proofforge/shared-types";
import type { Manifest } from "@proofforge/evidence-spec";
import type { EventBus } from "../events.js";
import { buildAnalysisManifest } from "../manifest.js";
import type { RepositoryCheckout } from "./checkout.js";
import type { EvidenceProducer } from "./evidence-producer.js";

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
  "WAITING_FOR_HUMAN_APPROVAL",
];

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Last line of defense before an error reaches the logs. The checkout already
 * redacts its own failures, but anything carrying a credential must never be
 * logged just because it arrived from somewhere else.
 */
function redactSecrets(message: string): string {
  return message
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "***");
}

export class AnalysisRunner {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: Storage,
    private readonly events: EventBus,
    private readonly stepMs: number,
    private readonly evidence?: EvidencePipeline,
    private readonly logger: RunnerLogger = { warn: (message) => console.warn(message) },
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
    try {
      const analysis = await this.storage.getAnalysis(analysisId);
      if (!analysis) throw new Error(`analysis not found: ${analysisId}`);
      const repository = await this.storage.getRepository(analysis.repositoryId);
      if (!repository) throw new Error(`repository not found: ${analysis.repositoryId}`);

      for (const status of PIPELINE) {
        await sleep(this.stepMs);
        if (!canTransition(previous, status)) {
          throw new Error(`illegal transition ${previous} -> ${status}`);
        }

        if (status === "EVIDENCE_GENERATION") {
          await this.generateEvidence(analysisId, repository.owner, repository.name, {
            commit: analysis.commitSha,
            branch: repository.defaultBranch,
          });
        }

        await this.storage.updateAnalysis(analysisId, { status });
        this.events.publish(analysisId, {
          version: EVENT_SCHEMA_VERSION,
          type: "status",
          analysisId,
          status,
          previousStatus: previous,
          at: new Date().toISOString(),
        });
        previous = status;
      }

      const final = await this.storage.getAnalysis(analysisId);
      this.events.publish(analysisId, {
        version: EVENT_SCHEMA_VERSION,
        type: "completed",
        analysisId,
        status: "WAITING_FOR_HUMAN_APPROVAL",
        riskScore: final?.riskScore ?? null,
        evidenceBundleId: final?.evidenceBundleId ?? null,
        at: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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

  private async generateEvidence(
    analysisId: string,
    owner: string,
    name: string,
    change: { commit: string; branch: string },
  ): Promise<void> {
    const manifest =
      (await this.collectRealEvidence(owner, name, change)) ??
      buildAnalysisManifest({
        id: randomUUID(),
        owner,
        name,
        commit: change.commit,
        baseCommit: change.commit,
        branch: change.branch,
        // Interim placeholder risk; the engine supplies real scoring when available,
        // and the Risk Engine (Phase 6) supersedes both.
        riskScore: 18,
        riskLevel: "low",
      });

    const riskScore = manifest.risk.score;
    const riskLevel = manifest.risk.level as RiskLevel;

    const bundle = await this.storage.createEvidenceBundle({
      analysisId,
      commitSha: change.commit,
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
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[evidence] falling back to a simulated manifest for ${owner}/${name}@${change.commit.slice(0, 7)}: ${message}`,
      );
      return null;
    } finally {
      await checkout?.dispose();
    }
  }
}
