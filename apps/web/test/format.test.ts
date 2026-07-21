/**
 * How state is coloured for a reader.
 *
 * Tone is the fastest thing a person reads on this page — before the label,
 * before the number. A status that falls through to the wrong tone tells them
 * the opposite of the truth at a glance.
 */
import { describe, expect, it } from "vitest";

import { ANALYSIS_STATUSES } from "@proofforge/shared-types";
import { riskTone, shortSha, statusLabel, statusTone } from "@/lib/format";

describe("status labels", () => {
  it("turns the wire value into prose", () => {
    expect(statusLabel("WAITING_FOR_HUMAN_APPROVAL")).toBe("Waiting For Human Approval");
  });

  it("handles a single-word status", () => {
    expect(statusLabel("APPROVED")).toBe("Approved");
  });
});

describe("status tone", () => {
  it.each([
    ["APPROVED", "success"],
    ["REJECTED", "danger"],
    ["FAILED", "danger"],
    ["CANCELLED", "danger"],
    ["WAITING_FOR_HUMAN_APPROVAL", "warning"],
    ["CREATED", "neutral"],
    ["TESTING", "progress"],
  ] as const)("shows %s as %s", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it("never leaves a terminal failure looking like work in progress", () => {
    // The catch-all returns "progress", so a new terminal status added to the
    // enum would silently render as if the analysis were still running.
    const terminal = ANALYSIS_STATUSES.filter((s) => /FAIL|REJECT|CANCEL/.test(s));

    for (const status of terminal) {
      expect(statusTone(status)).toBe("danger");
    }
  });
});

describe("risk tone", () => {
  it.each([
    ["low", "success"],
    ["moderate", "progress"],
    ["elevated", "warning"],
    ["high", "warning"],
    ["critical", "danger"],
  ] as const)("shows %s risk as %s", (level, tone) => {
    expect(riskTone(level)).toBe(tone);
  });

  it("shows an absent level as neutral, not as low", () => {
    // The distinction this whole project turns on: no risk score is not a
    // good risk score, and it must not be coloured like one.
    expect(riskTone(null)).toBe("neutral");
    expect(riskTone("unrecognised")).toBe("neutral");
  });
});

describe("shortSha", () => {
  it("keeps the seven characters people actually quote", () => {
    expect(shortSha("9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912")).toBe("9c82fd1");
  });
});
