import { describe, it, expect } from "vitest";
import { daysOverdue } from "./dunning";

describe("daysOverdue", () => {
  it("counts whole days past the due date", () => {
    expect(daysOverdue("2026-03-15", "2026-03-20")).toBe(5);
    expect(daysOverdue("2026-03-15", "2026-03-15")).toBe(0);
    expect(daysOverdue("2026-02-28", "2026-03-15")).toBe(15);
  });
  it("is negative before the due date", () => {
    expect(daysOverdue("2026-03-20", "2026-03-15")).toBe(-5);
  });
});
