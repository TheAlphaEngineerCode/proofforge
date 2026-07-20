/**
 * Running the reviewer agent as part of an analysis.
 *
 * The agent's opinion never decides anything. The verdict comes from the
 * evidence and the policy, both deterministic; a review adds findings a human
 * reads and a record of what it cost. Letting a model's judgement move the
 * verdict would undo the property the whole product is built on.
 *
 * A failed review is recorded as a failed review. It does not fail the analysis
 * — the evidence stands on its own — and it does not quietly vanish either,
 * which would leave a manifest that looks reviewed and is not.
 */

import type { AiProvider } from "@proofforge/ai-providers";
import { reviewChange, type Finding } from "@proofforge/agents";
import type { Manifest } from "@proofforge/evidence-spec";
import { computeEvidenceHash } from "@proofforge/evidence-spec";

export interface AgentReviewLogger {
  warn(message: string): void;
}

export interface AgentReviewResult {
  readonly findings: readonly Finding[];
  /** Redirection attempts found in the change. Reported, never obeyed. */
  readonly injectionSignals: readonly string[];
  /** Set when no review exists, and why. */
  readonly failureReason?: string;
}

export class AgentReviewer {
  constructor(
    private readonly provider: AiProvider,
    private readonly logger: AgentReviewLogger,
  ) {}

  /**
   * Review the change and record the run in the manifest.
   *
   * Mutates `manifest` and re-stamps its hash, the same as the policy gate: a
   * document whose hash does not match its contents is worse than useless.
   */
  async review(manifest: Manifest, diff: string, description?: string): Promise<AgentReviewResult> {
    const outcome = await reviewChange(this.provider, { diff, description });

    const usage = outcome.usage;
    manifest.agents = [
      ...manifest.agents,
      {
        agentType: "reviewer",
        provider: this.provider.name,
        model: this.provider.model,
        ...(usage === null
          ? {}
          : {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              // Omitted rather than zeroed when the model has no published
              // rate: a cost of 0 would read as a free call.
              ...(usage.costUsd === null ? {} : { cost: usage.costUsd }),
            }),
      },
    ];
    manifest.evidenceHash = computeEvidenceHash(manifest);

    if (outcome.status === "failed") {
      this.logger.warn(`[agent] the review did not complete: ${outcome.reason}`);
      return { findings: [], injectionSignals: [], failureReason: outcome.reason };
    }

    if (outcome.injectionSignals.length > 0) {
      this.logger.warn(
        `[agent] the change contains text addressed to the reviewer: ${outcome.injectionSignals.join(", ")}`,
      );
    }

    return { findings: outcome.findings, injectionSignals: outcome.injectionSignals };
  }
}
