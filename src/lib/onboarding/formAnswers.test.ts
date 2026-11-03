import { describe, it, expect } from "vitest";
import { attributionLine } from "./formAnswers";

describe("attributionLine", () => {
  it("formats the brief's per-field marker with email + role", () => {
    const line = attributionLine({
      updated_by_email: "jim@creditcanary.co.uk",
      updated_by_role: "Procurement",
      updated_at: "2026-03-25T10:12:00.000Z",
    });
    expect(line).toContain("Updated");
    expect(line).toContain("jim@creditcanary.co.uk");
    expect(line).toContain("(Procurement)");
  });

  it("omits the role parens when there's no role", () => {
    const line = attributionLine({ updated_by_email: "a@b.com", updated_by_role: null, updated_at: "2026-03-25T10:12:00.000Z" });
    expect(line).toContain("a@b.com");
    expect(line).not.toContain("(");
  });

  it("falls back to 'someone' and returns null when empty", () => {
    expect(attributionLine({ updated_by_email: null, updated_by_role: null, updated_at: "2026-03-25T10:12:00.000Z" })).toContain("someone");
    expect(attributionLine(null)).toBeNull();
    expect(attributionLine(undefined)).toBeNull();
  });
});
