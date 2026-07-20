import { describe, expect, it } from "vitest";

import { ExitCode } from "../src/exit-codes.js";
import { PLANNED, unavailableNotice } from "../src/planned.js";

describe("commands that are declared but do not work yet", () => {
  it.each(PLANNED)("$name exits non-zero", (command) => {
    // A script calling this must not read "did nothing" as "succeeded" — the
    // exact confusion the rest of this project exists to prevent.
    expect(unavailableNotice(command).exitCode).not.toBe(ExitCode.Success);
    expect(unavailableNotice(command).exitCode).toBe(ExitCode.UsageError);
  });

  it.each(PLANNED)("$name says what is missing without naming a phase", (command) => {
    // "arrives in Phase 6" reads as available once Phase 6 ships. Two of these
    // outlived the phase they named and told users to expect a working command.
    expect(command.note).not.toMatch(/phase/i);
    expect(unavailableNotice(command).message).toContain(command.note);
  });

  it("does not claim a command that is already wired", () => {
    const shipped = ["manifest", "evidence", "policy"];

    expect(PLANNED.map((command) => command.name)).not.toEqual(
      expect.arrayContaining(shipped),
    );
  });
});
