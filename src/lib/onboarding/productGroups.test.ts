import { describe, it, expect } from "vitest";
import {
  normalizeSelection,
  lockedSelections,
  isLightTouch,
  requiresFullKyc,
  requiresTuSection,
  requiresPayments,
  requiresDirectDebit,
  requiresFcaFrn,
  requiresUboKyc,
  documentsFor,
} from "./productGroups";

describe("product group selection rules", () => {
  it("Settlement Accounts auto-selects Faster Payments", () => {
    const sel = normalizeSelection(["settlement_accounts"]);
    expect(sel).toContain("settlement_accounts");
    expect(sel).toContain("faster_payments");
    expect(lockedSelections(["settlement_accounts"]).has("faster_payments")).toBe(true);
  });

  it("drops unknown keys and keeps catalog order", () => {
    expect(normalizeSelection(["nonsense", "tu_credit", "pay_by_bank"])).toEqual([
      "tu_credit",
      "pay_by_bank",
    ]);
  });

  it("is light-touch only when every selected group is light", () => {
    expect(isLightTouch(["open_banking_data"])).toBe(true);
    expect(isLightTouch(["open_banking_data", "confirmation_of_payee"])).toBe(true);
    expect(isLightTouch(["open_banking_data", "direct_debits"])).toBe(false);
    expect(isLightTouch([])).toBe(false);
  });

  it("requires full KYC / UBO work when any full group is selected", () => {
    expect(requiresFullKyc(["open_banking_data"])).toBe(false);
    expect(requiresFullKyc(["direct_debits"])).toBe(true);
    expect(requiresUboKyc(["confirmation_of_payee"])).toBe(false);
    expect(requiresUboKyc(["tu_credit"])).toBe(true);
  });

  it("gates the TU section, payments pages and DD sub-form correctly", () => {
    expect(requiresTuSection(["tu_credit"])).toBe(true);
    expect(requiresTuSection(["pay_by_bank"])).toBe(false);
    expect(requiresPayments(["pay_by_bank"])).toBe(true);
    expect(requiresPayments(["open_banking_data"])).toBe(false);
    expect(requiresDirectDebit(["direct_debits"])).toBe(true);
    expect(requiresDirectDebit(["cvrp"])).toBe(false);
  });

  it("requires an FCA FRN for TU Credit but not TU Monevo", () => {
    expect(requiresFcaFrn(["tu_credit"])).toBe(true);
    expect(requiresFcaFrn(["tu_monevo"])).toBe(false);
  });

  it("maps selections to the right documents", () => {
    expect(documentsFor(["direct_debits"]).sort()).toEqual(
      ["dd_questionnaire", "merchant_onboarding_form"].sort(),
    );
    expect(documentsFor(["tu_credit"]).sort()).toEqual(
      ["tu_credit_eua", "tu_due_diligence_xlsx"].sort(),
    );
    // Settlement + its auto-selected FPS both map to the single merchant form.
    expect(documentsFor(normalizeSelection(["settlement_accounts"]))).toEqual([
      "merchant_onboarding_form",
    ]);
    expect(documentsFor(["open_banking_data"])).toEqual([]);
  });
});
