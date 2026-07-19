import { readFileSync } from "node:fs";
import { verifyManifest } from "@proofforge/evidence-spec";
import { ExitCode } from "../exit-codes.js";
import { CliError, readJsonFile } from "../io.js";
import { fail, heading, jsonBlock, pass, warn, type CommandResult } from "../output.js";

export interface EvidenceVerifyOptions {
  json?: boolean;
  /** Path to a public key file (PEM or raw base64) to verify the signature. */
  publicKey?: string;
  /** Require a cryptographically valid signature to pass. */
  requireSignature?: boolean;
}

/** `proofforge evidence verify <file>` — full integrity + signature verification. */
export function evidenceVerify(path: string, options: EvidenceVerifyOptions = {}): CommandResult {
  const input = readJsonFile(path);

  let publicKey: string | undefined;
  if (options.publicKey) {
    try {
      publicKey = readFileSync(options.publicKey, "utf8").trim();
    } catch {
      throw new CliError(`Cannot read public key file: ${options.publicKey}`, ExitCode.UsageError);
    }
  }

  const result = verifyManifest(input, {
    publicKey,
    requireSignature: options.requireSignature ?? false,
  });

  if (options.json) {
    return {
      exitCode: result.valid ? ExitCode.Success : ExitCode.VerificationFailed,
      stdout: jsonBlock({
        valid: result.valid,
        versionSupported: result.versionSupported,
        structureValid: result.structure.valid,
        hash: result.hash,
        signature: result.signature,
        issues: result.structure.issues,
      }),
    };
  }

  const lines: string[] = [heading(`Evidence verification — ${path}`), ""];

  lines.push(result.structure.valid ? pass("Structure matches schema") : fail("Structure invalid"));
  if (!result.structure.valid) {
    for (const issue of result.structure.issues) lines.push(`    ${issue.path}: ${issue.message}`);
    return { exitCode: ExitCode.VerificationFailed, stdout: lines.join("\n") };
  }

  lines.push(
    result.versionSupported
      ? pass("Spec version supported")
      : fail(`Unsupported spec version: ${result.manifest?.specVersion}`),
  );

  if (result.hash) {
    lines.push(
      result.hash.valid
        ? pass(`Evidence hash matches (${result.hash.expected})`)
        : fail(`Evidence hash mismatch\n    expected ${result.hash.expected}\n    found    ${result.hash.actual}`),
    );
  }

  if (result.signature) {
    switch (result.signature.status) {
      case "valid":
        lines.push(pass("Signature valid"));
        break;
      case "invalid":
        lines.push(fail("Signature invalid"));
        break;
      case "unsigned":
        lines.push(warn("Manifest is unsigned"));
        break;
      case "no-key":
        lines.push(warn("Signature present but no public key supplied (use --public-key)"));
        break;
    }
  }

  lines.push("");
  lines.push(result.valid ? pass(heading("VERIFIED")) : fail(heading("FAILED")));

  return {
    exitCode: result.valid ? ExitCode.Success : ExitCode.VerificationFailed,
    stdout: lines.join("\n"),
  };
}
