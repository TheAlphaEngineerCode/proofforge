import pc from "picocolors";

export interface CommandResult {
  exitCode: number;
  stdout: string;
}

export const pass = (s: string): string => `${pc.green("✓")} ${s}`;
export const fail = (s: string): string => `${pc.red("✗")} ${s}`;
export const warn = (s: string): string => `${pc.yellow("⚠")} ${s}`;

export function heading(s: string): string {
  return pc.bold(s);
}

/**
 * Remove control characters (including ANSI escape sequences) from untrusted
 * strings before printing them. Manifest content is untrusted input; a field
 * such as a repository name or change title could otherwise inject escape codes
 * into the user's terminal. We keep printable characters and drop the C0/C1
 * control ranges plus DEL.
 */
export function safe(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isC0 = code < 0x20;
    const isDelOrC1 = code >= 0x7f && code <= 0x9f;
    if (!isC0 && !isDelOrC1) out += char;
  }
  return out;
}

export function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
