import { describe, it, expect } from "vitest";
import { computeInvoice, graduatedCharge, volumeCharge, resolveEscalation, monthlyAmount, type EngineItem, type EngineBand, type EngineInput } from "./engine";

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

describe("volumeCharge (whole-volume tiers — Jim's model)", () => {
  // OB AIS-style: lands in ONE tier, whole volume at that tier's rate, tier min floors.
  const obBands = [
    band(0, 1000, 33, "monthly", 25000),
    band(1001, 5000, 25, "monthly", 100000),
    band(5001, null, 20, "monthly", 150000),
  ];
  it("charges every unit at the tier the volume lands in (not cumulative slices)", () => {
    // 3000 → tier 2: 3000*25 = 75000, floored to tier-2 min 100000
    expect(volumeCharge(3000, obBands).amount_pence).toBe(100000);
    // 4500 → tier 2: 4500*25 = 112500 (above the min)
    expect(volumeCharge(4500, obBands).amount_pence).toBe(112500);
    // 6000 → tier 3: 6000*20 = 120000, floored to 150000
    expect(volumeCharge(6000, obBands).amount_pence).toBe(150000);
  });
  it("tier minimum floors low usage, and applies at zero usage (committed floor)", () => {
    expect(volumeCharge(200, obBands).amount_pence).toBe(25000); // 200*33=6600 → floor 25000
    expect(volumeCharge(0, obBands).amount_pence).toBe(25000);   // 0 → tier 1 floor
  });
  it("differs from graduated for the same bands", () => {
    const g = graduatedCharge(3000, obBands).amount_pence; // 1000*33 + 2000*25 = 83000 (floored)
    expect(g).not.toBe(volumeCharge(3000, obBands).amount_pence);
  });
});

describe("resolveEscalation", () => {
  it("anchors relative start-months on the contract start", () => {
    const r = resolveEscalation([{ start_month: 0, amount_pence: 250000 }, { start_month: 12, amount_pence: 350000 }, { start_month: 24, amount_pence: 450000 }], "2026-03-01");
    expect(r).toEqual([
      { from_date: "2026-03-01", amount_pence: 250000 },
      { from_date: "2027-03-01", amount_pence: 350000 },
      { from_date: "2028-03-01", amount_pence: 450000 },
    ]);
  });
  it("undefined for an empty schedule", () => {
    expect(resolveEscalation(undefined, "2026-03-01")).toBeUndefined();
    expect(resolveEscalation([], "2026-03-01")).toBeUndefined();
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

describe("computeInvoice — recurring + proration (arrears)", () => {
  it("full month in arrears when the whole month is active, with 20% VAT", () => {
    const inv = computeInvoice(base([platform(10000)], { isFirstInvoice: true }));
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ line_amount_pence: 10000, vat_pence: 2000, vat_rate: 0.2 });
    expect(inv.total_pence).toBe(12000);
    expect(inv.prorated).toBe(false);
  });

  it("pro-rates the start month to the active days (mid-month start)", () => {
    // start 2026-02-15 (28-day Feb); the Feb invoice bills 14/28 of the month.
    const inv = computeInvoice(base([platform(10000)], { isFirstInvoice: true, contractStartDate: "2026-02-15", periodMonth: "2026-02-01" }));
    expect(inv.prorated).toBe(true);
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]?.line_amount_pence).toBe(Math.round(10000 * (14 / 28))); // 5000
  });

  it("start on the last day of a 31-day month prorates 1/31", () => {
    const inv = computeInvoice(base([platform(31000)], { isFirstInvoice: true, contractStartDate: "2026-01-31", periodMonth: "2026-01-01" }));
    expect(inv.lines[0]?.line_amount_pence).toBe(1000); // 31000 * 1/31
  });

  it("pro-rates the final month to the cancellation date (M3)", () => {
    // cancel effective 2026-03-10 → March active days 1–10 = 10/31.
    const inv = computeInvoice(base([platform(31000)], { contractEndDate: "2026-03-10", periodMonth: "2026-03-01" }));
    expect(inv.prorated).toBe(true);
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]?.line_amount_pence).toBe(Math.round(31000 * (10 / 31))); // 10000
  });

  it("due date is relative to the issue date, not the billed month", () => {
    const inv = computeInvoice(base([platform(10000)], { periodMonth: "2026-02-01", issueDate: "2026-03-01", dueDays: 14 }));
    expect(inv.due_date).toBe("2026-03-15");
  });
});

describe("computeInvoice — setup, cancellation, VAT, usage", () => {
  const setup = (amt: number, trigger?: "on_contract_signed" | "on_go_live"): EngineItem => ({ billing_item_id: "s", item_type: "setup_fee", label: "Setup fee", metric: "flat_monthly", vat_treatment: "standard", config: trigger ? { amount_pence: amt, billing_trigger: trigger } : { amount_pence: amt }, bands: [] });

  it("on_go_live setup fee bills on the first invoice only", () => {
    expect(computeInvoice(base([setup(50000, "on_go_live")], { isFirstInvoice: true })).lines).toHaveLength(1);
    expect(computeInvoice(base([setup(50000, "on_go_live")], { isFirstInvoice: false })).lines).toHaveLength(0);
  });

  it("on_contract_signed (default) setup fee defers until the contract is signed", () => {
    // first invoice, not yet signed → no setup line
    expect(computeInvoice(base([setup(50000)], { isFirstInvoice: true })).lines).toHaveLength(0);
    // signed, even on a LATER invoice → bills (once)
    expect(computeInvoice(base([setup(50000)], { isFirstInvoice: false, contractSigned: true })).lines).toHaveLength(1);
    // already carried on a prior invoice → never re-bills
    expect(computeInvoice(base([setup(50000)], { isFirstInvoice: false, contractSigned: true, setupFeeAlreadyBilled: true })).lines).toHaveLength(0);
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

  it("per_txn fixed+pct: fixed from count, % value billed as posted (no recompute/cap) — M1", () => {
    // pay_by_bank: 100 txns @ 20p fixed = 2000; the % component is pre-computed
    // at source and posted as value=95000 → billed AS-IS on a 1-unit line.
    const it: EngineItem = { billing_item_id: "x", item_type: "pay_by_bank", label: "PbB", metric: "per_txn_fixed_and_pct", vat_treatment: "exempt", config: { fixed_pence: 20, pct: 1, cap_pence: 25 }, bands: [], usage: { quantity: 100, value: 95000 } };
    const inv = computeInvoice(base([it]));
    expect(inv.lines).toHaveLength(2);
    const fixed = inv.lines.find((l) => l.calc.component === "fixed");
    const val = inv.lines.find((l) => l.calc.component === "value");
    expect(fixed?.line_amount_pence).toBe(2000); // 100 × 20p
    expect(val?.line_amount_pence).toBe(95000);  // posted value as-is, NOT recomputed or capped
    expect(val?.quantity).toBe(1);
    expect(inv.subtotal_pence).toBe(97000);
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

describe("computeInvoice — Billing v2: volume, included, group minimums, escalation", () => {
  const ob = (usage: number, extra: Partial<EngineItem> = {}): EngineItem => ({
    billing_item_id: "ob", item_type: "open_banking_ais", label: "Open Banking (AIS)", metric: "per_account_month",
    vat_treatment: "standard", product_group: "open_banking_data", band_mode: "volume", config: {},
    bands: [band(0, 1000, 33, "monthly", 25000), band(1001, 5000, 25, "monthly", 100000), band(5001, null, 20, "monthly", 150000)],
    usage: { quantity: usage }, ...extra,
  });

  it("volume product bills the tier the month's volume lands in", () => {
    const inv = computeInvoice(base([ob(3000)]));
    expect(inv.lines[0]?.line_amount_pence).toBe(100000); // tier-2 min
    expect(inv.lines[0]?.calc.mode).toBe("volume");
  });

  it("committed monthly minimum bills at zero usage WITHIN contract", () => {
    const inv = computeInvoice(base([ob(0)]));
    expect(inv.lines[0]?.line_amount_pence).toBe(25000); // tier-1 floor
  });

  it("no phantom minimum after cancellation (zero trailing usage → no line)", () => {
    const inv = computeInvoice(base([ob(0)], { contractEndDate: "2026-02-28", periodMonth: "2026-03-01" }));
    expect(inv.lines).toHaveLength(0);
  });

  it("trailing usage after cancellation bills actual, without the floor", () => {
    const inv = computeInvoice(base([ob(200)], { contractEndDate: "2026-02-28", periodMonth: "2026-03-01" }));
    expect(inv.lines[0]?.line_amount_pence).toBe(200 * 33); // 6600, NOT floored to 25000
  });

  it("'included' bills £0 and ignores reported usage", () => {
    const inv = computeInvoice(base([ob(4000, { config: { included: true } })]));
    expect(inv.lines[0]?.line_amount_pence).toBe(0);
    expect(inv.lines[0]?.calc.included).toBe(true);
  });

  it("category minimum tops up a group that bills under its floor", () => {
    const tu = (id: string, q: number): EngineItem => ({ billing_item_id: id, item_type: "tu_x", label: "TU " + id, metric: "per_request", vat_treatment: "standard", product_group: "tu_credit", config: {}, bands: [band(0, null, 50)], usage: { quantity: q } });
    const inv = computeInvoice(base([tu("a", 100), tu("b", 100)], { groupMinimums: [{ product_group: "tu_credit", minimum_pence: 50000 }] }));
    // 2 * (100*50) = 10000 billed → top-up 40000 to reach 50000
    const top = inv.lines.find((l) => l.calc.group_minimum);
    expect(top?.line_amount_pence).toBe(40000);
    expect(top?.vat_pence).toBe(8000); // standard VAT on the top-up
    expect(inv.subtotal_pence).toBe(50000);
  });

  it("no category top-up when the group already clears its floor, or isn't sold", () => {
    const tu: EngineItem = { billing_item_id: "a", item_type: "tu_x", label: "TU", metric: "per_request", vat_treatment: "standard", product_group: "tu_credit", config: {}, bands: [band(0, null, 50)], usage: { quantity: 2000 } };
    const over = computeInvoice(base([tu], { groupMinimums: [{ product_group: "tu_credit", minimum_pence: 50000 }] }));
    expect(over.lines.find((l) => l.calc.group_minimum)).toBeUndefined(); // 100000 ≥ 50000
    // group minimum for a category with no items on the account → nothing
    const none = computeInvoice(base([platform(10000)], { groupMinimums: [{ product_group: "tu_credit", minimum_pence: 50000 }] }));
    expect(none.lines.find((l) => l.calc.group_minimum)).toBeUndefined();
  });

  it("platform fee escalates by contract year via the resolved schedule", () => {
    const esc = resolveEscalation([{ start_month: 0, amount_pence: 250000 }, { start_month: 12, amount_pence: 350000 }, { start_month: 24, amount_pence: 450000 }], "2026-03-01")!;
    const pf = (period: string) => computeInvoice(base([platform(250000, { config: { amount_pence: 250000, escalation: esc } })], { contractStartDate: "2026-03-01", periodMonth: period }));
    expect(pf("2026-06-01").lines[0]?.line_amount_pence).toBe(250000); // Yr1
    expect(pf("2027-06-01").lines[0]?.line_amount_pence).toBe(350000); // Yr2
    expect(pf("2028-06-01").lines[0]?.line_amount_pence).toBe(450000); // Yr3
  });
});
