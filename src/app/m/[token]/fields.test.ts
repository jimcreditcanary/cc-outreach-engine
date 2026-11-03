import { describe, it, expect } from "vitest";
import { isPersonalEmailDomain, collectDpos, hasValidDpo, dpoSummary, missingCompanyFields } from "./fields";
import type { AnswerMap } from "@/lib/onboarding/formAnswers";

const mk = (pairs: Record<string, string>, unknown: string[] = []): AnswerMap =>
  Object.fromEntries(
    Object.entries(pairs).map(([k, v]) => [k, { value: v, is_unknown: unknown.includes(k), updated_by_email: null, updated_by_role: null, updated_at: "2026-01-01T00:00:00Z" }]),
  );

describe("isPersonalEmailDomain", () => {
  it("flags personal mailbox domains", () => {
    expect(isPersonalEmailDomain("a@gmail.com")).toBe(true);
    expect(isPersonalEmailDomain("A@Outlook.com")).toBe(true);
    expect(isPersonalEmailDomain("a@yahoo.co.uk")).toBe(true);
  });
  it("passes company domains and empties", () => {
    expect(isPersonalEmailDomain("a@creditcanary.co.uk")).toBe(false);
    expect(isPersonalEmailDomain("")).toBe(false);
    expect(isPersonalEmailDomain("noatsign")).toBe(false);
  });
});

describe("DPOs", () => {
  it("collects non-empty DPOs, validates, and summarises", () => {
    const a = mk({ dpo_0_first: "Jane", dpo_0_last: "Smith", dpo_0_email: "jane@x.com", dpo_0_title: "DPO", dpo_1_first: "", dpo_1_email: "" });
    const dpos = collectDpos(a);
    expect(dpos).toHaveLength(1);
    expect(hasValidDpo(a)).toBe(true);
    expect(dpoSummary(dpos)).toContain("Jane Smith");
    expect(dpoSummary(dpos)).toContain("jane@x.com");
  });
  it("is invalid without an email", () => {
    expect(hasValidDpo(mk({ dpo_0_first: "Jane" }))).toBe(false);
  });
});

describe("missingCompanyFields", () => {
  it("treats a 'don't know' as satisfying a required field", () => {
    const base = { trading_name: "A", trading_address: "B", phone: "1", email: "a@co.com", website: "https://co.com", signatory_name: "S", signatory_title: "T", signatory_email: "s@co.com" };
    expect(missingCompanyFields(mk({ ...base, ico_number: "" }), { fcaRequired: false, tuCredit: false })).toContain("ICO registration number");
    expect(missingCompanyFields(mk({ ...base, ico_number: "" }, ["ico_number"]), { fcaRequired: false, tuCredit: false })).not.toContain("ICO registration number");
  });
  it("requires FCA FRN only when a TU product is selected", () => {
    const base = mk({ trading_name: "A", trading_address: "B", phone: "1", email: "a@co.com", website: "https://co.com", ico_number: "Z", signatory_name: "S", signatory_title: "T", signatory_email: "s@co.com" });
    expect(missingCompanyFields(base, { fcaRequired: false, tuCredit: false })).toHaveLength(0);
    expect(missingCompanyFields(base, { fcaRequired: true, tuCredit: false })).toContain("FCA registration number (FRN)");
  });
});
