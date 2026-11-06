import { describe, it, expect } from "vitest";
import { pickTaxTypes, buildXeroInvoiceBody, interpretInvoiceStatus, getXero, type XeroTaxRate, type XeroInvoiceInput } from "./xero";

describe("pickTaxTypes (X2)", () => {
  const rate = (over: Partial<XeroTaxRate>): XeroTaxRate => ({ Name: "", TaxType: "", EffectiveRate: 0, Status: "ACTIVE", CanApplyToRevenue: true, ...over });

  it("resolves the org's 20% output and exempt output codes", () => {
    const rates = [
      rate({ Name: "20% (VAT on Income)", TaxType: "OUTPUT2", EffectiveRate: 20 }),
      rate({ Name: "Exempt Income", TaxType: "EXEMPTOUTPUT", EffectiveRate: 0 }),
      rate({ Name: "20% (VAT on Expenses)", TaxType: "INPUT2", EffectiveRate: 20, CanApplyToRevenue: false }),
    ];
    expect(pickTaxTypes(rates)).toEqual({ standard: "OUTPUT2", exempt: "EXEMPTOUTPUT" });
  });

  it("prefers an explicitly-named exempt rate over any other 0% revenue rate", () => {
    const rates = [
      rate({ Name: "Zero Rated Income", TaxType: "ZERORATEDOUTPUT", EffectiveRate: 0 }),
      rate({ Name: "Exempt Income", TaxType: "EXEMPTOUTPUT", EffectiveRate: 0 }),
      rate({ Name: "20%", TaxType: "OUTPUT2", EffectiveRate: 20 }),
    ];
    expect(pickTaxTypes(rates).exempt).toBe("EXEMPTOUTPUT");
  });

  it("ignores non-active and non-revenue rates and falls back to UK defaults", () => {
    const rates = [rate({ Name: "20%", TaxType: "OLD", EffectiveRate: 20, Status: "DELETED" })];
    expect(pickTaxTypes(rates)).toEqual({ standard: "OUTPUT2", exempt: "EXEMPTOUTPUT" });
    expect(pickTaxTypes([])).toEqual({ standard: "OUTPUT2", exempt: "EXEMPTOUTPUT" });
  });
});

describe("buildXeroInvoiceBody", () => {
  const input: XeroInvoiceInput = {
    contactId: "c1", reference: "acct-2026-03", periodMonth: "2026-03-01", dueDate: "2026-04-15",
    lines: [
      { description: "Platform fee — 2026-03", quantity: 1, unitAmountPence: 2500, vatRate: 0.2 },
      { description: "Faster Payments — 10 txns", quantity: 1, unitAmountPence: 250, vatRate: 0 },
    ],
  };
  const tax = { standard: "OUTPUT2", exempt: "EXEMPTOUTPUT" };

  it("maps pence→pounds, picks tax type by VAT rate, and authorises when approved", () => {
    const body = buildXeroInvoiceBody(input, true, tax);
    const inv = body.Invoices[0]!;
    expect(inv.Type).toBe("ACCREC");
    expect(inv.Status).toBe("AUTHORISED");
    expect(inv.LineAmountTypes).toBe("Exclusive");
    expect(inv.Date).toBe("2026-03-01");
    expect(inv.DueDate).toBe("2026-04-15");
    expect(inv.LineItems[0]).toMatchObject({ UnitAmount: 25, TaxType: "OUTPUT2", Quantity: 1 });
    expect(inv.LineItems[1]).toMatchObject({ UnitAmount: 2.5, TaxType: "EXEMPTOUTPUT" });
  });

  it("drafts when not approved", () => {
    expect(buildXeroInvoiceBody(input, false, tax).Invoices[0]!.Status).toBe("DRAFT");
  });
});

describe("interpretInvoiceStatus", () => {
  it("PAID is paid; zero amount-due is paid; positive amount-due is not", () => {
    expect(interpretInvoiceStatus("PAID", 0)).toMatchObject({ paid: true, amountDuePence: 0 });
    expect(interpretInvoiceStatus("AUTHORISED", 0)).toMatchObject({ paid: true });
    expect(interpretInvoiceStatus("AUTHORISED", 120.5)).toMatchObject({ paid: false, amountDuePence: 12050 });
  });
  it("defaults an unknown status and leaves amount-due undefined", () => {
    expect(interpretInvoiceStatus(undefined, undefined)).toEqual({ status: "UNKNOWN", paid: false, amountDuePence: undefined });
  });
});

describe("mock Xero client (deterministic — no creds)", () => {
  it("returns stable ids and honours the approve flag", async () => {
    const x = getXero(); // no XERO_CLIENT_ID in tests → mock
    const a = await x.ensureContact({ accountKey: "acct-1", name: "Acme" });
    const b = await x.ensureContact({ accountKey: "acct-1", name: "Acme renamed" });
    expect(a.contactId).toBe(b.contactId); // keyed on accountKey, stable
    expect((await x.createInvoice({ contactId: a.contactId, reference: "r1", periodMonth: "2026-03-01", dueDate: "2026-04-15", lines: [] }, true)).status).toBe("AUTHORISED");
    expect((await x.createInvoice({ contactId: a.contactId, reference: "r1", periodMonth: "2026-03-01", dueDate: "2026-04-15", lines: [] }, false)).status).toBe("DRAFT");
  });
});
