import { describe, it, expect } from "vitest";
import { deriveTier } from "../derive";

describe("deriveTier", () => {
  it("T1 — an open deal with a proposal", () => {
    expect(
      deriveTier([
        { status: "open", proposal_exists: true },
        { status: "lost", proposal_exists: true },
      ]),
    ).toBe(1);
  });

  it("T2 — only closed deals carry a proposal", () => {
    expect(
      deriveTier([
        { status: "won", proposal_exists: true },
        { status: "open", proposal_exists: false },
      ]),
    ).toBe(2);
  });

  it("T2 — lost deal with a proposal, no open-with-proposal", () => {
    expect(deriveTier([{ status: "lost", proposal_exists: true }])).toBe(2);
  });

  it("T3 — open deal but no proposal anywhere", () => {
    expect(deriveTier([{ status: "open", proposal_exists: false }])).toBe(3);
  });

  it("T3 — org with no deals at all", () => {
    expect(deriveTier([])).toBe(3);
  });

  it("hottest state wins: open+proposal beats closed+proposal", () => {
    expect(
      deriveTier([
        { status: "lost", proposal_exists: true },
        { status: "open", proposal_exists: true },
        { status: "won", proposal_exists: true },
      ]),
    ).toBe(1);
  });
});
