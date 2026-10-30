import { describe, it, expect } from "vitest";
import { CATALOGUE, ITEM_TYPES, METRICS, VAT_TREATMENTS, isItemType, labelFor } from "./catalogue";
import { parseBandsText } from "./bands";
import { roleCanEditPricing } from "@/lib/auth/role";

describe("billing catalogue", () => {
  it("every entry has a valid metric and VAT treatment", () => {
    for (const e of CATALOGUE) {
      expect(METRICS).toContain(e.metric);
      expect(VAT_TREATMENTS).toContain(e.vat);
      expect(e.key).toMatch(/^[a-z0-9_]+$/);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it("item keys are unique and ITEM_TYPES mirrors the catalogue", () => {
    const keys = CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ITEM_TYPES).toEqual(keys);
  });

  it("payment rails default to VAT-exempt (brief Assumption 3)", () => {
    for (const k of ["pay_by_bank", "faster_payments", "settlement_accounts", "sweeping_vrp", "cvrp", "direct_debits"]) {
      expect(CATALOGUE.find((e) => e.key === k)?.vat).toBe("exempt");
    }
  });

  it("isItemType / labelFor", () => {
    expect(isItemType("tu_call_report")).toBe(true);
    expect(isItemType("nope")).toBe(false);
    expect(labelFor("setup_fee")).toBe("Setup fee");
    expect(labelFor("unknown")).toBe("unknown");
  });
});

describe("parseBandsText", () => {
  it("parses graduated bands with an unbounded top band", () => {
    const bands = parseBandsText("0 | 1000 | 100 | none | 0\n1001 | * | 80 | monthly | 5000");
    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({ from_units: 0, to_units: 1000, unit_price_pence: 100, minimum_type: "none", minimum_pence: 0, sort_order: 0 });
    expect(bands[1]).toMatchObject({ from_units: 1001, to_units: null, unit_price_pence: 80, minimum_type: "monthly", minimum_pence: 5000, sort_order: 1 });
  });

  it("ignores blank lines, accepts commas, and defaults an invalid min type to none", () => {
    const bands = parseBandsText("\n0,500,25,bogus,0\n\n");
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ from_units: 0, to_units: 500, unit_price_pence: 25, minimum_type: "none" });
  });

  it("coerces non-numeric price to 0 and rounds to pence", () => {
    const bands = parseBandsText("0 | 100 | abc | none | 0\n0 | 100 | 12.7 | none | 0");
    expect(bands[0]?.unit_price_pence).toBe(0);
    expect(bands[1]?.unit_price_pence).toBe(13);
  });
});

describe("roleCanEditPricing", () => {
  it("only super_admin may edit pricing", () => {
    expect(roleCanEditPricing("super_admin")).toBe(true);
    expect(roleCanEditPricing("operator")).toBe(false);
    expect(roleCanEditPricing(null)).toBe(false);
  });
});
