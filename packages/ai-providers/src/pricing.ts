/**
 * Published rates, in USD per million tokens.
 *
 * A model missing from this table yields a null cost rather than a zero one.
 * Recording an unmeasured cost as zero is the same failure the risk score was
 * built to avoid, and it would understate spend in exactly the cases where
 * someone is watching it.
 */

export interface Rate {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

export const RATES: Readonly<Record<string, Rate>> = {
  "claude-opus-4-8": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  "claude-opus-4-7": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  "claude-sonnet-5": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};

/** Cost of one call, or null when the model's rate is unknown to us. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const rate = RATES[model];
  if (rate === undefined) return null;

  const dollars =
    (inputTokens / 1_000_000) * rate.inputPerMTok +
    (outputTokens / 1_000_000) * rate.outputPerMTok;

  // Sub-cent precision matters: a single review is cheap, and a run that makes
  // hundreds of calls should not accumulate rounding error.
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
