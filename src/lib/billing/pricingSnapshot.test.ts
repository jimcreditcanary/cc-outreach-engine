import { describe, it, expect } from "vitest";
import { buildPricingSnapshot, asPricedSnapshot } from "./pricingSnapshot";
import type { PricingTable, PricingBand } from "./repo";

const table = (over: Partial<PricingTable> = {}): PricingTable => ({
  id: "pt_1", item_type: "ob_ais", name: "Open Banking AIS", product_group: "open_banking", metric: "per_account_month",
  config: { cap_pence: 300 }, vat_treatment: "standard", band_mode: "volume", product_type: "variable",
  billing_frequency: null, delayed_start_months: 0, active: true, internal_notes: null, sort_order: 0,
  is_placeholder: false, version: 3, effective_from: "2026-01-01", effective_to: null,
  created_at: "", updated_at: "", ...over,
});
const band = (from: number, to: number | null, price: number): PricingBand => ({
  id: `b_${from}`, pricing_table_id: "pt_1", from_units: from, to_units: to, unit_price_pence: price,
  minimum_type: "none", minimum_pence: 0, unit_cap_pence: null, sort_order: from,
});

describe("buildPricingSnapshot", () => {
  it("freezes metric, bands, version, and merges catalogue + item config", () => {
    const snap = buildPricingSnapshot(table(), [band(0, 100, 50), band(100, null, 40)], { included: false, cap_pence: 500 }, null, "flat_monthly", "2026-06-01T00:00:00Z");
    expect(snap.metric).toBe("per_account_month");
    expect(snap.table_version).toBe(3);
    expect(snap.effective_from).toBe("2026-01-01");
    expect(snap.band_mode).toBe("volume");
    expect(snap.product_group).toBe("open_banking");
    expect(snap.bands).toHaveLength(2);
    expect(snap.bands[1]).toMatchObject({ from_units: 100, to_units: null, unit_price_pence: 40 });
    // item config wins over catalogue default
    expect(snap.config.cap_pence).toBe(500);
    expect(snap.snapped_at).toBe("2026-06-01T00:00:00Z");
  });

  it("per-item VAT overrides the table's", () => {
    expect(buildPricingSnapshot(table({ vat_treatment: "standard" }), [], {}, "exempt", "flat_monthly", "t").vat_treatment).toBe("exempt");
  });

  it("falls back to sane defaults when there is no pricing table", () => {
    const snap = buildPricingSnapshot(null, [], { amount_pence: 9000 }, null, "flat_monthly", "t");
    expect(snap).toMatchObject({ pricing_table_id: null, table_version: null, metric: "flat_monthly", vat_treatment: "standard", band_mode: "volume", product_group: null });
    expect(snap.config.amount_pence).toBe(9000);
  });
});

describe("asPricedSnapshot", () => {
  it("accepts a well-formed snapshot and rejects junk", () => {
    const good = buildPricingSnapshot(table(), [band(0, null, 10)], {}, null, "flat_monthly", "t");
    expect(asPricedSnapshot(good)).not.toBeNull();
    expect(asPricedSnapshot(null)).toBeNull();
    expect(asPricedSnapshot({})).toBeNull();
    expect(asPricedSnapshot({ metric: "flat_monthly" })).toBeNull(); // missing bands/config
  });
});
