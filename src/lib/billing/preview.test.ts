import { describe, it, expect } from "vitest";
import { firstMonthProration, previewFirstInvoice, type PreviewItem } from "./preview";

describe("firstMonthProration", () => {
  it("start on the 1st is a full month", () => {
    const p = firstMonthProration("2026-01-01");
    expect(p).toMatchObject({ partialDays: 31, monthDays: 31, isFirstOfMonth: true });
    expect(p.factor).toBe(1);
  });
  it("mid-month in a 31-day month", () => {
    const p = firstMonthProration("2026-01-15");
    expect(p).toMatchObject({ partialDays: 17, monthDays: 31, isFirstOfMonth: false });
  });
  it("non-leap February", () => {
    expect(firstMonthProration("2026-02-15")).toMatchObject({ partialDays: 14, monthDays: 28 });
  });
  it("30-day month", () => {
    expect(firstMonthProration("2026-04-15")).toMatchObject({ partialDays: 16, monthDays: 30 });
  });
});

const platform = (amount_pence: number): PreviewItem => ({
  item_type: "platform_fee", label: "Platform fee", metric: "flat_monthly", vat_treatment: "standard", config: { amount_pence },
});

describe("previewFirstInvoice", () => {
  it("full month when starting on the 1st", () => {
    const inv = previewFirstInvoice([platform(10000)], "2026-01-01");
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ net_pence: 10000, vat_pence: 2000, gross_pence: 12000 });
    expect(inv.total_pence).toBe(12000);
  });

  it("pro-rata partial month + first full month in advance when starting mid-month", () => {
    const inv = previewFirstInvoice([platform(10000)], "2026-01-15");
    expect(inv.lines).toHaveLength(2);
    // 10000 * 17/31 = 5483.87 → 5484
    expect(inv.lines[0]?.net_pence).toBe(5484);
    expect(inv.lines[1]?.net_pence).toBe(10000);
    expect(inv.subtotal_pence).toBe(15484);
    expect(inv.vat_pence).toBe(Math.round(5484 * 0.2) + Math.round(10000 * 0.2));
  });

  it("setup fee is a one-off line; VAT-exempt lines carry no VAT", () => {
    const inv = previewFirstInvoice(
      [
        { item_type: "setup_fee", label: "Setup fee", metric: "flat_monthly", vat_treatment: "standard", config: { amount_pence: 50000 } },
        { item_type: "settlement_accounts", label: "Settlement accounts", metric: "per_account_month", vat_treatment: "exempt", config: { included: true } },
      ],
      "2026-03-01",
    );
    const setup = inv.lines.find((l) => l.label === "Setup fee");
    expect(setup).toMatchObject({ net_pence: 50000, vat_pence: 10000 });
    const settle = inv.lines.find((l) => l.label === "Settlement accounts");
    expect(settle).toMatchObject({ net_pence: 0, vat_pence: 0 });
  });

  it("usage/transaction items produce a note, not a line", () => {
    const inv = previewFirstInvoice(
      [{ item_type: "tu_call_report", label: "TU Call Report", metric: "per_request", vat_treatment: "standard", config: { amount_pence: 50 } }],
      "2026-01-01",
    );
    expect(inv.lines).toHaveLength(0);
    expect(inv.notes.some((n) => n.includes("TU Call Report"))).toBe(true);
  });
});
