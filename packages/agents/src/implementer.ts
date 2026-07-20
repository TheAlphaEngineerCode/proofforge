/**
 * The implementation agent: proposes file contents for one approved step.
 *
 * It proposes; it does not write. Nothing here touches a filesystem, and the
 * caller decides what to do with the result — which keeps the agent's blast
 * radius equal to whatever the caller applies, rather than to whatever the model
 * happened to emit.
 */

import { encloseUntrusted, UNTRUSTED_CONTENT_RULES } from "@proofforge/ai-providers";
import type { AiProvider, CompletionResult } from "@proofforge/ai-providers";
import { z } from "zod";

import { describeError, failed, stopReasonProblem, type AgentOutcome } from "./outcome.js";
import { parseJsonReply } from "./parse.js";
import type { PlanStep } from "./planner.js";

const EditSchema = z.object({
  path: z.string().min(1),
  /** The file's full contents after the change: no patch dialect to misapply. */
  contents: z.string(),
  /** Why this file changed, for the reviewer rather than the compiler. */
  reason: z.string().min(1),
});

const ProposalSchema = z.object({
  edits: z.array(EditSchema).min(1),
  /** What the agent could not do, and why. Silence here would be a lie. */
  notes: z.array(z.string()).default([]),
});

export type ProposedEdit = z.infer<typeof EditSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;

export interface ImplementRequest {
  readonly step: PlanStep;
  /** Current contents of the files the step names, keyed by path. */
  readonly files: Readonly<Record<string, string>>;
  readonly maxTokens?: number;
}

const SYSTEM_PROMPT = [
  "You implement one step of an approved plan.",
  "",
  UNTRUSTED_CONTENT_RULES,
  "",
  "Return the complete contents of each file you change, not a patch. Change only",
  "what the step calls for: a bug fix does not need the surrounding cleanup, and",
  "an abstraction nobody asked for is a cost the reviewer has to carry.",
  "",
  "If the step cannot be done with the files you were given, say so in notes and",
  "return the files unchanged. Guessing at code you cannot see produces a change",
  "that looks finished and is not.",
  "",
  "Reply with a single JSON object and nothing else:",
  '{"edits":[{"path":string,"contents":string,"reason":string}],"notes":[string]}',
].join("\n");

export async function implementStep(
  provider: AiProvider,
  request: ImplementRequest,
): Promise<AgentOutcome<Proposal>> {
  const step = encloseUntrusted("step", JSON.stringify(request.step));
  const files = Object.entries(request.files).map(([path, contents]) =>
    encloseUntrusted(`file:${path}`, contents),
  );

  const signals = [
    ...new Set([...step.injectionSignals, ...files.flatMap((file) => file.injectionSignals)]),
  ].sort();

  let result: CompletionResult;
  try {
    result = await provider.complete({
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: [step.text, ...files.map((file) => file.text)].join("\n\n") },
      ],
      maxTokens: request.maxTokens ?? 16384,
    });
  } catch (error) {
    return failed(`the provider call failed: ${describeError(error)}`);
  }

  const problem = stopReasonProblem(result);
  if (problem !== null) return failed(problem, result.usage);

  const parsed = parseJsonReply(result.text, ProposalSchema, "proposal");
  if (!parsed.ok) return failed(parsed.reason, result.usage);

  const escaping = parsed.value.edits.filter((edit) => !isContainedPath(edit.path));
  if (escaping.length > 0) {
    // The model chooses these paths, and a caller writing them out would follow
    // an absolute path or a `..` straight out of the repository.
    return failed(
      `the proposal edits paths outside the repository: ${escaping
        .map((edit) => edit.path)
        .join(", ")}`,
      result.usage,
    );
  }

  return {
    status: "ok",
    value: parsed.value,
    injectionSignals: signals,
    usage: result.usage,
  };
}

/** Whether a path stays inside the repository when resolved. */
export function isContainedPath(path: string): boolean {
  // A NUL truncates the path in many filesystem APIs, so a name that looks
  // contained here can resolve to a shorter one on disk. The rest of the
  // control range has no business in a filename and does have business
  // corrupting any log or terminal that prints it.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;

  const normalised = path.replace(/\\/g, "/");

  if (normalised.startsWith("/")) return false;
  // Windows drive letters, and UNC paths.
  if (/^[a-zA-Z]:/.test(normalised)) return false;

  const segments: string[] = [];
  for (const segment of normalised.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return false;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0;
}
