/**
 * The planning agent: turns a request into steps a human can approve.
 *
 * The plan exists to be reviewed before anything is written, so it is the
 * artefact that matters most in agent mode — a plan nobody read is an agent
 * editing a repository on its own recognisance.
 */

import { encloseUntrusted, UNTRUSTED_CONTENT_RULES } from "@proofforge/ai-providers";
import type { AiProvider, CompletionResult } from "@proofforge/ai-providers";
import { z } from "zod";

import { describeError, failed, stopReasonProblem, type AgentOutcome } from "./outcome.js";
import { parseJsonReply } from "./parse.js";

const StepSchema = z.object({
  /** One action, stated so a reviewer can tell whether it happened. */
  summary: z.string().min(1),
  /** Paths this step expects to touch. Empty when the step adds a new file. */
  files: z.array(z.string()).default([]),
  rationale: z.string().min(1),
});

const PlanSchema = z.object({
  /** What the change is meant to achieve, restated by the planner. */
  goal: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  /** Things the planner could not settle. A plan that admits these is worth more. */
  openQuestions: z.array(z.string()).default([]),
  /** What the planner deliberately left out of scope. */
  outOfScope: z.array(z.string()).default([]),
});

export type PlanStep = z.infer<typeof StepSchema>;
export type Plan = z.infer<typeof PlanSchema>;

export interface PlanRequest {
  /** What the user asked for. Written by a person, so untrusted. */
  readonly task: string;
  /** Repository context — structure, conventions. Also untrusted. */
  readonly context?: string;
  readonly maxTokens?: number;
}

const SYSTEM_PROMPT = [
  "You plan a software change. You do not write code — a separate step does that,",
  "and only after a human approves your plan.",
  "",
  UNTRUSTED_CONTENT_RULES,
  "",
  "Break the work into steps small enough that a reviewer can tell whether each",
  "one happened. State what you are not doing, and say plainly what you could not",
  "determine rather than inventing an answer: an unanswered question in the plan",
  "is cheaper than a wrong assumption in the code.",
  "",
  "Reply with a single JSON object and nothing else:",
  '{"goal":string,"steps":[{"summary":string,"files":[string],"rationale":string}],',
  '"openQuestions":[string],"outOfScope":[string]}',
].join("\n");

export async function planChange(
  provider: AiProvider,
  request: PlanRequest,
): Promise<AgentOutcome<Plan>> {
  const task = encloseUntrusted("task", request.task);
  const context =
    request.context === undefined ? null : encloseUntrusted("repository-context", request.context);

  const signals = [
    ...new Set([...task.injectionSignals, ...(context?.injectionSignals ?? [])]),
  ].sort();

  const parts = [context?.text, task.text].filter((part): part is string => part !== undefined);

  let result: CompletionResult;
  try {
    result = await provider.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: parts.join("\n\n") }],
      maxTokens: request.maxTokens ?? 8192,
    });
  } catch (error) {
    return failed(`the provider call failed: ${describeError(error)}`);
  }

  const problem = stopReasonProblem(result);
  if (problem !== null) return failed(problem, result.usage);

  const parsed = parseJsonReply(result.text, PlanSchema, "plan");
  if (!parsed.ok) return failed(parsed.reason, result.usage);

  return {
    status: "ok",
    value: parsed.value,
    injectionSignals: signals,
    usage: result.usage,
  };
}
