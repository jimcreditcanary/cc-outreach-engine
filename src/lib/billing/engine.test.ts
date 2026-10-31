import { describe, it, expect } from "vitest";
import { computeInvoice, graduatedCharge, monthlyAmount, type EngineItem, type EngineBand, type EngineInput } from "./engine";

const band = (from: number, to: number | null, price: number, minType: EngineBand["minimum_type"] = "none", min = 0): EngineBand => ({ from_units: from, to_units: to, unit_price_pence: price, minimum_type: minType, minimum_pence: min });

function platform(amount: number, extra: Partial<EngineItem> = {}): EngineItem {
  return { billing_item_id: "p", item_type: "platform_fee", label: "Platform fee", metric: "flat_monthly", vat_treatment: "standard", config: { amount_pence: amount }, bands: [], ...extra };
}
function base(items: EngineItem[], over: Partial<EngineInput> = {}): EngineInput {
  return { periodMonth: "2026-03-01", isFirstInvoice: false, contractStartDate: "2026-03-01", contractEndDate: null, items, ...over };
}

describe("graduatedCharge", () => {
  it("zero usage → zero", () => {
    expect(graduatedCharge(0, [band(0, 1000, 100), band(1000, 2000, 80)]).amount_pence).toBe(0);
  });
  it("graduated across bands (units within each band)", () => {
    // 1500 units: 1000@100 + 500@80 = 100000 + 40000
    expect(graduatedCharge(1500, [band(0, 1000, 100), band(1000, 2000, 80)]).amount_pence).toBe(140000);
  });
  it("single unbounded band", () => {
    expect(graduatedCharge(50, [band(0, null, 50)]).amount_pence).toBe(2500);
  });
  it("monthly minimum floors a low usage", () => {
    // 10 units * 100 = 1000, but monthly floor 5000
    expect(graduatedCharge(10, [band(0, null, 100, "monthly", 5000)]).amount_pence).toBe(5000);
  });
  it("on_band_hit minimum only applies once the band is reached", () => {
    const bands = [band(0, 1000, 100), band(1000, null, 80, "on_band_hit", 90000)];
    expect(graduatedCharge(500, bands).amount_pence).toBe(50000);      // band 2 not reached → no floor
    expect(graduatedCharge(1100, bands).amount_pence).toBe(100000 + 8000); // 108000 > floor 90000
    expect(graduatedCharge(1001, bands).amount_pence).toBe(Math.max(100000 + 80, 90000)); // floor wins? 100080 > 90000
  });
});

describe("monthlyAmount escalation", () => {
  const cfg = { amount_pence: 10000, escalation: [{ from_date: "2026-01-01", amount_pence: 10000 }, { from_date: "2026-07-01", amount_pence: 12000 }] };
  it("picks the amount effective for the period", () => {
    expect(monthlyAmount(cfg, "2026-03-01")).toBe(10000);
    expect(monthlyAmount(cfg, "2026-06-01")).toBe(10000);
    expect(monthlyAmount(cfg, "2026-07-01")).toBe(12000); // boundary
    expect(monthlyAmount(cfg, "2026-09-01")).toBe(12000);
  });
  it("falls back to amount_pence with no schedule", () => {
    expect(monthlyAmount({ amount_pence: 5000 }, "2026-03-01")).toBe(5000);
  });
});

describe("computeInvoice — recurring + proration", () => {
  it("full month in advance when starting on the 1st, with 20% VAT", () => {
    const inv = computeInvoice(base([platform(10000)], { isFirstInvoice: true }));
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ line_amount_pence: 10000, vat_pence: 2000, vat_rate: 0.2 });
    expect(inv.total_pence).toBe(12000);
    expect(inv.prorated).toBe(false);
  });

  it("pro-rata partial month + full month on the first invoice (start mid-month)", () => {
    // start 2026-02-15 (28-day Feb) → first invoice period 2026-03; partial Feb = 14/28
    const inv = computeInvoice(base([platform(10000)], { isFirstInvoice: true, contractStartDate: "2026-02-15", periodMonth: "2026-03-01" }));
    expect(inv.prorated).toBe(true);
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]?.line_amount_pence).toBe(Math.round(10000 * (14 / 28))); // 5000
    expect(inv.lines[1]?.line_amount_pence).toBe(10000);
  });

  it("start on the last day of a 31-day month prorates 1/31", () => {
    const inv = computeInvoice(base([platform(31000)], { isFirstInvoice: true, contractStartDate: "2026-01-31", periodMonth: "2026-02-01" }));
    expect(inv.lines[0]?.line_amount_pence).toBe(1000); // 31000 * 1/31
  });
});

describe("computeInvoice — setup, cancellation, VAT, usage", () => {
  const setup = (amt: number): EngineItem => ({ billing_item_id: "s", item_type: "setup_fee", label: "Setup fee", metric: "flat_monthly", vat_treatment: "standard", config: { amount_pence: amt }, bands: [] });

  it("setup fee one-off only on the first invoice", () => {
    expect(computeInvoice(base([setup(50000)], { isFirstInvoice: true })).lines).toHaveLength(1);
    expect(computeInvoice(base([setup(50000)], { isFirstInvoice: false })).lines).toHaveLength(0);
  });

  it("no recurring after cancellation, but trailing usage is still billed", () => {
    const tu: EngineItem = { billing_item_id: "t", item_type: "tu_call_report", label: "TU", metric: "per_request", vat_treatment: "standard", config: {}, bands: [band(0, null, 50)], usage: { quantity: 100 } };
    const inv = computeInvoice(base([platform(10000), tu], { contractEndDate: "2026-02-28", periodMonth: "2026-03-01" }));
    // platform (recurring) suppressed; TU usage billed
    expect(inv.lines.find((l) => l.description.includes("Platform"))).toBeUndefined();
    const tuLine = inv.lines.find((l) => l.description.includes("TU"));
    expect(tuLine?.line_amount_pence).toBe(5000);
  });

  it("VAT-exempt line carries no VAT", () => {
    const fp: EngineItem = { billing_item_id: "f", item_type: "faster_payments", label: "FP", metric: "per_txn_fixed", vat_treatment: "exempt", config: { fixed_pence: 20 }, bands: [], usage: { quantity: 1000 } };
    const inv = computeInvoice(base([fp]));
    expect(inv.lines[0]).toMatchObject({ line_amount_pence: 20000, vat_pence: 0, vat_rate: 0 });
  });

  it("per_txn fixed+pct with a per-txn cap", () => {
    // 100 txns, £950 total value, 20p fixed + 1% → 100*20 + round(95000*0.01)=2000+950=2950; cap 25p/txn → 2500
    const it: EngineItem = { billing_item_id: "x", item_type: "pay_by_bank", label: "PbB", metric: "per_txn_fixed_and_pct", vat_treatment: "exempt", config: { fixed_pence: 20, pct: 1, cap_pence: 25 }, bands: [], usage: { quantity: 100, value: 95000 } };
    const inv = computeInvoice(base([it]));
    expect(inv.lines[0]?.line_amount_pence).toBe(2500);
    expect(inv.lines[0]?.calc.capped_from).toBe(2950);
  });

  it("zero usage produces no line", () => {
    const tu: EngineItem = { billing_item_id: "t", item_type: "tu_call_report", label: "TU", metric: "per_request", vat_treatment: "standard", config: {}, bands: [band(0, null, 50)], usage: { quantity: 0 } };
    expect(computeInvoice(base([tu])).lines).toHaveLength(0);
  });

  it("is deterministic — a re-run yields identical totals", () => {
    const input = base([platform(10000)], { isFirstInvoice: true, contractStartDate: "2026-02-15", periodMonth: "2026-03-01" });
    const a = computeInvoice(input);
    const b = computeInvoice(input);
    expect(a).toEqual(b);
  });
});
