import { describe, expect, it } from "vitest";
import { canTransition, isTerminal, nextStatuses } from "../src/states.js";

describe("analysis state machine", () => {
  it("allows the defined forward transitions", () => {
    expect(canTransition("CREATED", "REPOSITORY_ANALYSIS_PENDING")).toBe(true);
    expect(canTransition("TESTING", "SECURITY_ANALYSIS")).toBe(true);
    expect(canTransition("POLICY_VALIDATION", "WAITING_FOR_HUMAN_APPROVAL")).toBe(true);
  });

  it("rejects transitions that skip states", () => {
    expect(canTransition("CREATED", "TESTING")).toBe(false);
    expect(canTransition("TESTING", "CREATED")).toBe(false);
  });

  it("allows FAILED and CANCELLED from any non-terminal state", () => {
    expect(canTransition("TESTING", "FAILED")).toBe(true);
    expect(canTransition("PLANNING", "CANCELLED")).toBe(true);
  });

  it("does not allow transitions out of a terminal state", () => {
    expect(isTerminal("APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "REPOSITORY_ANALYSIS_PENDING")).toBe(false);
    expect(canTransition("FAILED", "CANCELLED")).toBe(false);
  });

  it("exposes the next legal states", () => {
    expect(nextStatuses("CREATED")).toEqual(["REPOSITORY_ANALYSIS_PENDING"]);
    expect(nextStatuses("APPROVED")).toEqual([]);
  });
});
