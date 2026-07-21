/**
 * What the badges tell a reviewer at a glance.
 *
 * This is the last surface the project's central distinction has to survive:
 * a change with no risk score must not look like a change that scored well.
 * Everything upstream can be careful and it still fails here if the badge
 * renders a reassuring colour over an absent measurement.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RiskBadge, StatusBadge } from "@/components/badges";

afterEach(cleanup);

describe("RiskBadge", () => {
  it("shows the score and the level when there is one", () => {
    render(<RiskBadge score={63} level="high" />);

    expect(screen.getByText(/63\/100/)).toBeDefined();
    expect(screen.getByText(/high/)).toBeDefined();
  });

  it("says outright that no risk has been scored yet", () => {
    render(<RiskBadge score={null} level={null} />);

    const badge = screen.getByText("No risk yet");
    expect(badge.className).toContain("tone-neutral");
  });

  it("does not render an unscored change in a reassuring colour", () => {
    render(<RiskBadge score={null} level={null} />);

    expect(screen.getByText("No risk yet").className).not.toContain("tone-success");
  });

  it("treats a zero score as measured, not as missing", () => {
    // A zero is a real result and has to read as one — the same ambiguity the
    // evidence collectors exist to remove.
    render(<RiskBadge score={0} level="low" />);

    expect(screen.getByText(/0\/100/)).toBeDefined();
  });
});

describe("StatusBadge", () => {
  it("renders the label and the tone together", () => {
    render(<StatusBadge status="APPROVED" />);

    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("tone-success");
  });

  it("shows a failure as a failure", () => {
    render(<StatusBadge status="FAILED" />);

    expect(screen.getByText("Failed").className).toContain("tone-danger");
  });
});
