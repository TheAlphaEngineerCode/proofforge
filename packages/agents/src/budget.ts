/**
 * A spending limit for one agent run.
 *
 * An agent loop can call a model many times, and the failure mode is a run that
 * quietly costs far more than anyone intended. The budget is checked before each
 * call rather than after, so the limit is a limit and not a report.
 *
 * Cost is not always knowable — a provider we have no published rate for
 * returns null — and a budget that silently treats unknown as zero would not be
 * a budget at all. So calls are counted as well, and a USD limit reports itself
 * as unenforceable rather than pretending to hold.
 */

import type { Usage } from "@proofforge/ai-providers";

export interface BudgetLimits {
  /** Hard ceiling on model spend for the run. */
  readonly maxUsd?: number;
  /** Ceiling on calls, which holds even when cost is unknown. */
  readonly maxCalls?: number;
}

export type BudgetState =
  | { readonly withinBudget: true }
  | { readonly withinBudget: false; readonly reason: string };

export class Budget {
  #spentUsd = 0;
  #calls = 0;
  /** True once any call reported an unknown cost. */
  #costIncomplete = false;

  constructor(private readonly limits: BudgetLimits = {}) {}

  get spentUsd(): number {
    return this.#spentUsd;
  }

  get calls(): number {
    return this.#calls;
  }

  /**
   * Whether the spend figure accounts for every call.
   *
   * False means at least one call had no published rate, so `spentUsd` is a
   * lower bound. Anything reporting cost to a human must say so.
   */
  get costComplete(): boolean {
    return !this.#costIncomplete;
  }

  record(usage: Usage): void {
    this.#calls += 1;
    if (usage.costUsd === null) {
      this.#costIncomplete = true;
      return;
    }
    this.#spentUsd += usage.costUsd;
  }

  /** Checked before spending, so an exhausted budget stops the next call. */
  check(): BudgetState {
    const { maxCalls, maxUsd } = this.limits;

    if (maxCalls !== undefined && this.#calls >= maxCalls) {
      return {
        withinBudget: false,
        reason: `the run reached its limit of ${maxCalls} model calls`,
      };
    }

    if (maxUsd !== undefined) {
      if (this.#costIncomplete) {
        // Refusing here would strand a run over a bookkeeping gap; continuing
        // silently would let it outspend a limit someone set on purpose. Say
        // which one it is and let the caller decide.
        return {
          withinBudget: false,
          reason:
            "the spend limit cannot be enforced: a model with no published rate was used, " +
            "so the run's cost is unknown",
        };
      }
      if (this.#spentUsd >= maxUsd) {
        return {
          withinBudget: false,
          reason: `the run reached its limit of $${maxUsd.toFixed(2)} (spent $${this.#spentUsd.toFixed(4)})`,
        };
      }
    }

    return { withinBudget: true };
  }
}
