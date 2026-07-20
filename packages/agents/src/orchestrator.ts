/**
 * Running the agents as one task.
 *
 * The loop is: plan, stop for a human, then implement the approved steps. The
 * stop is not a convention — `plan()` returns a plan and nothing else, and
 * `implement()` requires an approval object the caller can only get by deciding.
 * An agent that edits a repository without anyone reading its plan is the thing
 * this design is built to prevent.
 *
 * Nothing here writes to disk. The orchestrator returns proposed contents and
 * the caller applies them, so the damage an agent can do is bounded by what the
 * caller chooses to write rather than by what the model chose to emit.
 */

import type { AiProvider } from "@proofforge/ai-providers";

import { Budget, type BudgetLimits } from "./budget.js";
import { implementStep, type Proposal } from "./implementer.js";
import { planChange, type Plan, type PlanStep } from "./planner.js";
import { failed, type AgentOutcome } from "./outcome.js";

export interface TaskRequest {
  readonly task: string;
  readonly context?: string;
  readonly limits?: BudgetLimits;
}

/**
 * A human's decision on a plan.
 *
 * Constructed only through `approvePlan`, so an approval cannot be forged by
 * assembling an object literal — the caller has to name who approved it.
 */
export class PlanApproval {
  private readonly brand = Symbol.for("proofforge.plan-approval");

  private constructor(
    readonly plan: Plan,
    readonly approvedBy: string,
    readonly approvedSteps: readonly PlanStep[],
  ) {}

  static grant(plan: Plan, approvedBy: string, steps?: readonly PlanStep[]): PlanApproval {
    if (approvedBy.trim() === "") {
      // An unattributed approval is not an approval; it is a blank cheque.
      throw new Error("a plan approval must name who approved it");
    }
    const approved = steps ?? plan.steps;
    if (approved.length === 0) {
      throw new Error("a plan approval must include at least one step");
    }
    // Compared by content, not by reference. A plan shown to a human travels
    // through JSON to get there and back, so it returns as equal objects that
    // are never the same objects — reference equality would reject every
    // approval that crossed a process boundary, which is all of the real ones.
    const known = new Set(plan.steps.map(fingerprint));
    for (const step of approved) {
      if (!known.has(fingerprint(step))) {
        // The check still matters: without it a caller could approve one plan
        // and hand over different steps, and the record would name a human who
        // never saw them.
        throw new Error("approved steps must come from the plan that was reviewed");
      }
    }
    return new PlanApproval(plan, approvedBy, approved);
  }

  /** Silences the unused-member warning while keeping the brand private. */
  toString(): string {
    return `PlanApproval(${String(this.brand.description)}, by ${this.approvedBy})`;
  }
}

/** Identifies a step by what it says, since that is what a human read. */
function fingerprint(step: PlanStep): string {
  return JSON.stringify([step.summary, [...step.files].sort(), step.rationale]);
}

export interface StepResult {
  readonly step: PlanStep;
  readonly outcome: AgentOutcome<Proposal>;
}

export interface RunReport {
  readonly steps: readonly StepResult[];
  /** True only when every approved step produced a proposal. */
  readonly complete: boolean;
  readonly spentUsd: number;
  /** False when a call had no published rate, making `spentUsd` a lower bound. */
  readonly costComplete: boolean;
  readonly calls: number;
  /** Set when the run stopped early. */
  readonly stoppedBecause?: string;
}

export class AgentRun {
  readonly budget: Budget;

  constructor(
    private readonly provider: AiProvider,
    limits: BudgetLimits = {},
  ) {
    this.budget = new Budget(limits);
  }

  /** Produce a plan. Nothing is implemented until someone approves it. */
  async plan(request: TaskRequest): Promise<AgentOutcome<Plan>> {
    const state = this.budget.check();
    if (!state.withinBudget) return failed(state.reason);

    const outcome = await planChange(this.provider, {
      task: request.task,
      context: request.context,
    });
    if (outcome.usage !== null) this.budget.record(outcome.usage);
    return outcome;
  }

  /**
   * Implement the approved steps, stopping at the first failure.
   *
   * Continuing past a failed step would build later steps on a foundation that
   * was never laid, and the result would look like a finished change.
   */
  async implement(
    approval: PlanApproval,
    files: Readonly<Record<string, string>>,
  ): Promise<RunReport> {
    const results: StepResult[] = [];
    let stoppedBecause: string | undefined;

    for (const step of approval.approvedSteps) {
      const state = this.budget.check();
      if (!state.withinBudget) {
        stoppedBecause = state.reason;
        break;
      }

      const outcome = await implementStep(this.provider, {
        step,
        files: pickFiles(files, step),
      });
      if (outcome.usage !== null) this.budget.record(outcome.usage);
      results.push({ step, outcome });

      if (outcome.status === "failed") {
        stoppedBecause = `step "${step.summary}" failed: ${outcome.reason}`;
        break;
      }
    }

    return {
      steps: results,
      complete:
        stoppedBecause === undefined &&
        results.length === approval.approvedSteps.length &&
        results.every((result) => result.outcome.status === "ok"),
      spentUsd: this.budget.spentUsd,
      costComplete: this.budget.costComplete,
      calls: this.budget.calls,
      ...(stoppedBecause === undefined ? {} : { stoppedBecause }),
    };
  }
}

/**
 * Only the files a step names.
 *
 * Sending the whole repository would cost more on every step and give the model
 * more to change than the step called for.
 */
function pickFiles(
  files: Readonly<Record<string, string>>,
  step: PlanStep,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const path of step.files) {
    const contents = files[path];
    if (contents !== undefined) picked[path] = contents;
  }
  return picked;
}
