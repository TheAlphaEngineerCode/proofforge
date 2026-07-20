/**
 * The reviewer agent: reads a change and reports what it found.
 *
 * The one rule this module exists to enforce is that a review which did not
 * happen must never read like a review that found nothing. A model can refuse,
 * run out of tokens, or return prose where JSON was asked for — and in every
 * one of those cases the honest answer is "not reviewed", not "no findings".
 * `ReviewOutcome` makes that a type, so a caller cannot reach the findings
 * without first passing the case where there are none to reach.
 */

import { encloseUntrusted, UNTRUSTED_CONTENT_RULES } from "@proofforge/ai-providers";
import type { AiProvider, CompletionResult } from "@proofforge/ai-providers";
import { z } from "zod";

import { describeError } from "./outcome.js";
import { parseJsonReply } from "./parse.js";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

const FindingSchema = z.object({
  file: z.string().min(1),
  /** Null when the finding is about the change as a whole. */
  line: z.number().int().positive().nullable(),
  severity: z.enum(SEVERITIES),
  category: z.string().min(1),
  summary: z.string().min(1),
  /** What breaks, concretely. A finding without this is an opinion. */
  failureScenario: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

const ReplySchema = z.object({ findings: z.array(FindingSchema) });

export type Finding = z.infer<typeof FindingSchema>;

export interface ReviewRequest {
  /** The unified diff. Written by the change's author, so untrusted. */
  readonly diff: string;
  /** Optional prose from the pull request. Also untrusted. */
  readonly description?: string;
  readonly maxTokens?: number;
}

export type ReviewOutcome =
  | {
      readonly status: "reviewed";
      readonly findings: readonly Finding[];
      /** Redirection attempts seen in the change. Reported, never acted on. */
      readonly injectionSignals: readonly string[];
      readonly usage: CompletionResult["usage"];
    }
  | {
      readonly status: "failed";
      /** Why no review exists. Carried into the manifest verbatim. */
      readonly reason: string;
      readonly usage: CompletionResult["usage"] | null;
    };

const SYSTEM_PROMPT = [
  "You review a proposed code change and report defects in it.",
  "",
  UNTRUSTED_CONTENT_RULES,
  "",
  "Report a finding only when you can name what breaks: the input or state that",
  "triggers it and the wrong behaviour that results. Style preferences, naming,",
  "and speculation about hypothetical future requirements are not findings.",
  "Prefer coverage over filtering — include findings you are unsure about and",
  "mark them with the confidence you actually have, since a later step ranks them.",
  "",
  "Reply with a single JSON object and nothing else:",
  '{"findings":[{"file":string,"line":number|null,"severity":"critical"|"high"|"medium"|"low",',
  '"category":string,"summary":string,"failureScenario":string,',
  '"confidence":"high"|"medium"|"low"}]}',
  "",
  "An empty findings array means you reviewed the change and found no defects.",
  "Never use it to mean you could not review the change.",
].join("\n");

export async function reviewChange(
  provider: AiProvider,
  request: ReviewRequest,
): Promise<ReviewOutcome> {
  const diff = encloseUntrusted("diff", request.diff);
  const description =
    request.description === undefined ? null : encloseUntrusted("pr-description", request.description);

  const signals = [
    ...new Set([...diff.injectionSignals, ...(description?.injectionSignals ?? [])]),
  ].sort();

  const parts = [description === null ? null : description.text, diff.text].filter(
    (part): part is string => part !== null,
  );

  let result: CompletionResult;
  try {
    result = await provider.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: parts.join("\n\n") }],
      maxTokens: request.maxTokens ?? 8192,
    });
  } catch (error) {
    // A transport failure is not a clean review either.
    return { status: "failed", reason: `the provider call failed: ${describeError(error)}`, usage: null };
  }

  if (result.stopReason !== "end_turn") {
    return {
      status: "failed",
      reason: `the model stopped with "${result.stopReason}" before finishing the review`,
      usage: result.usage,
    };
  }

  const parsed = parseJsonReply(result.text, ReplySchema, "finding");
  if (!parsed.ok) {
    return { status: "failed", reason: parsed.reason, usage: result.usage };
  }

  return {
    status: "reviewed",
    findings: parsed.value.findings,
    injectionSignals: signals,
    usage: result.usage,
  };
}
