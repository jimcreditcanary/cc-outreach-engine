import { describe, it, expect } from "vitest";
import { matchSignals, type SignalInput } from "../triggers";

const signals: SignalInput[] = [
  { title: "FCA finalises Consumer Duty review", summary: "Outcomes for vulnerable customers", link: "a", source: "fca" },
  { title: "New BNPL rules consultation", summary: "Buy now pay later under FCA", link: "b", source: "fca" },
  { title: "Bank Rate held at 4%", summary: "MPC decision", link: "c", source: "boe" },
];

describe("matchSignals", () => {
  it("matches Consumer Duty for any lending sector", () => {
    const m = matchSignals(signals, "credit_union");
    expect(m.some((s) => s.link === "a")).toBe(true);
    expect(m.find((s) => s.link === "a")!.note).toContain("Consumer Duty");
  });

  it("matches BNPL only for direct_lender / marketplace", () => {
    expect(matchSignals(signals, "direct_lender").some((s) => s.link === "b")).toBe(true);
    expect(matchSignals(signals, "credit_union").some((s) => s.link === "b")).toBe(false);
  });

  it("ignores irrelevant signals (rate decision matches nothing here)", () => {
    expect(matchSignals(signals, "utility").some((s) => s.link === "c")).toBe(false);
  });

  it("caps results", () => {
    expect(matchSignals(signals, "direct_lender", 1).length).toBe(1);
  });
});
