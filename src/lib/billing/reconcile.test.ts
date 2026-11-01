import { describe, it, expect } from "vitest";
import { reconcile, normaliseKey, type DealLine, type ConfiguredItem } from "./reconcile";

const deal = (sku: string | null, price: number | null, name = sku): DealLine => ({ sku, name, quantity: 1, price });
const cfg = (item_type: string, our_price_pence: number | null): ConfiguredItem => ({ item_type, label: item_type, our_price_pence });

describe("reconcile — were we accurate?", () => {
  it("exact match → accurate", () => {
    const r = reconcile([deal("tu_callml", 1.25), deal("platform_fee", 2500)], [cfg("tu_callml", 125), cfg("platform_fee", 250000)]);
    expect(r.accurate).toBe(true);
    expect(r.issues).toBe(0);
    expect(r.rows.every((x) => x.status === "ok")).toBe(true);
  });

  it("flags a deal product we didn't set up (missing_setup)", () => {
    const r = reconcile([deal("tu_callml", 1.25), deal("faster_payments", 0.25)], [cfg("tu_callml", 125)], { knownKeys: new Set(["tu_callml", "faster_payments"]) });
    expect(r.accurate).toBe(false);
    expect(r.rows.find((x) => x.item_type === "faster_payments")?.status).toBe("missing_setup");
  });

  it("flags something we set up that isn't on the deal (not_on_deal)", () => {
    const r = reconcile([deal("tu_callml", 1.25)], [cfg("tu_callml", 125), cfg("cop", null)]);
    expect(r.rows.find((x) => x.item_type === "cop")?.status).toBe("not_on_deal");
    expect(r.counts.not_on_deal).toBe(1);
  });

  it("flags a price difference (pounds → pence)", () => {
    const r = reconcile([deal("tu_callml", 1.50)], [cfg("tu_callml", 125)]); // sold £1.50, we bill £1.25
    const row = r.rows[0]!;
    expect(row.status).toBe("price_mismatch");
    expect(row.deal_price_pence).toBe(150);
    expect(row.our_price_pence).toBe(125);
  });

  it("does not flag price when our price isn't a scalar (volume-banded)", () => {
    const r = reconcile([deal("open_banking_ais", 0.33)], [cfg("open_banking_ais", null)]);
    expect(r.rows[0]?.status).toBe("ok");
  });

  it("flags an unrecognised SKU (unmapped)", () => {
    const r = reconcile([deal("mystery_sku", 9.99)], [cfg("tu_callml", 125)], { knownKeys: new Set(["tu_callml"]) });
    const row = r.rows.find((x) => x.label.includes("mystery") || x.item_type === "mystery_sku")!;
    expect(row.status).toBe("unmapped");
    // and tu_callml is reported not_on_deal
    expect(r.rows.find((x) => x.item_type === "tu_callml")?.status).toBe("not_on_deal");
  });

  it("applies SKU aliases and case/space normalisation", () => {
    const r = reconcile([deal(" TU-CallML ", 1.25)], [cfg("tu_callml", 125)], { skuAliases: { "tu-callml": "tu_callml" } });
    expect(r.accurate).toBe(true);
    expect(normaliseKey(" TU-CallML ")).toBe("tu-callml");
  });
});
