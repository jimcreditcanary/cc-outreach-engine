import { describe, it, expect } from "vitest";
import { stepStatus, firstIncompleteStep, readyToComplete, isOnboardingRole } from "./cases";

type C = Parameters<typeof stepStatus>[0];
const mk = (over: Partial<C> = {}): C => ({ company_number: null, product_groups: [], status: "started", ...over });

describe("onboarding wizard step progress", () => {
  it("a fresh case has nothing done and opens on Company", () => {
    const c = mk();
    expect(stepStatus(c, 0)).toEqual({ company: false, products: false, stakeholders: false, finish: false });
    expect(firstIncompleteStep(c, 0)).toBe("company");
    expect(readyToComplete(c, 0)).toBe(false);
  });

  it("confirming a company advances to Products", () => {
    const c = mk({ company_number: "09523048" });
    const s = stepStatus(c, 0);
    expect(s.company).toBe(true);
    expect(s.products).toBe(false);
    expect(firstIncompleteStep(c, 0)).toBe("products");
  });

  it("company + products but no stakeholders opens on Stakeholders and isn't ready", () => {
    const c = mk({ company_number: "09523048", product_groups: ["tu_credit"] });
    expect(firstIncompleteStep(c, 0)).toBe("stakeholders");
    expect(readyToComplete(c, 0)).toBe(false);
  });

  it("all three steps done → ready to complete, opens on Finish", () => {
    const c = mk({ company_number: "09523048", product_groups: ["tu_credit"] });
    expect(readyToComplete(c, 1)).toBe(true);
    expect(firstIncompleteStep(c, 1)).toBe("finish");
    expect(stepStatus(c, 1).finish).toBe(false); // finish only ticks once status moves off "started"
  });

  it("finish ticks once the case is marked internal_complete", () => {
    const c = mk({ company_number: "09523048", product_groups: ["tu_credit"], status: "internal_complete" });
    expect(stepStatus(c, 1).finish).toBe(true);
  });

  it("validates onboarding roles", () => {
    expect(isOnboardingRole("authorised_signatory")).toBe(true);
    expect(isOnboardingRole("economic_buyer")).toBe(true);
    expect(isOnboardingRole("ceo")).toBe(false);
  });
});
