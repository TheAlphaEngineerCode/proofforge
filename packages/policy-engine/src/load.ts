/** Reading a policy from YAML, with errors a human can act on. */
import { parse as parseYaml } from "yaml";
import { PolicySchema, type Policy } from "./schema.js";

export class PolicyError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

export function loadPolicy(source: string): Policy {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (err) {
    throw new PolicyError(`policy is not valid YAML: ${(err as Error).message}`);
  }

  if (document === null || document === undefined) {
    throw new PolicyError("policy file is empty");
  }

  const result = PolicySchema.safeParse(document);
  if (!result.success) {
    // Point at the exact key, so a typo is a one-line fix rather than a hunt.
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new PolicyError("policy does not match the schema", issues);
  }

  return result.data;
}
