import { describe, it, expect } from "vitest";
import { normalizePeriodMonth, usagePayloadEqual, usageBodySchema, clientUsageSchema, usageShapeError, validateUsageBatch, usageBatchHasErrors } from "./usage";

describe("normalizePeriodMonth", () => {
  it("coerces any date in the month to the 1st", () => {
    expect(normalizePeriodMonth("2026-01")).toBe("2026-01-01");
    expect(normalizePeriodMonth("2026-01-15")).toBe("2026-01-01");
    expect(normalizePeriodMonth("2026-12-31")).toBe("2026-12-01");
  });
  it("throws on garbage", () => {
    expect(() => normalizePeriodMonth("nope")).toThrow();
  });
});

const base = { period_month: "2026-01-01", quantity: 10, value: null, principal: null, application_outcome: null };

describe("usagePayloadEqual", () => {
  it("equal when billed fields match (and a date in the month normalises)", () => {
    expect(usagePayloadEqual(base, { period_month: "2026-01-20", quantity: 10, idempotency_key: "k" })).toBe(true);
  });
  it("null stored vs omitted incoming are equal", () => {
    expect(usagePayloadEqual(base, { period_month: "2026-01", quantity: 10, idempotency_key: "k" })).toBe(true);
  });
  it("different quantity / value / period are not equal", () => {
    expect(usagePayloadEqual(base, { period_month: "2026-01", quantity: 11, idempotency_key: "k" })).toBe(false);
    expect(usagePayloadEqual(base, { period_month: "2026-01", quantity: 10, value: 5, idempotency_key: "k" })).toBe(false);
    expect(usagePayloadEqual(base, { period_month: "2026-02", quantity: 10, idempotency_key: "k" })).toBe(false);
  });
});

describe("usageBodySchema", () => {
  it("accepts a single record and a batch; rejects a bad one", () => {
    expect(usageBodySchema.safeParse({ period_month: "2026-01", quantity: 1, idempotency_key: "abcdefgh" }).success).toBe(true);
    expect(usageBodySchema.safeParse([{ period_month: "2026-01", quantity: 1, idempotency_key: "abcdefgh" }]).success).toBe(true);
    expect(usageBodySchema.safeParse({ period_month: "2026-01", quantity: -1, idempotency_key: "abcdefgh" }).success).toBe(false);
    expect(usageBodySchema.safeParse({ period_month: "2026-01", quantity: 1, idempotency_key: "short" }).success).toBe(false);
  });
});

describe("clientUsageSchema", () => {
  it("accepts a client feed with multiple products", () => {
    const ok = clientUsageSchema.safeParse({ client_ref: "9175484", period_month: "2026-02", usage: [{ item_type: "tu_call_report", quantity: 100 }, { item_type: "tu_callml", quantity: 250 }] });
    expect(ok.success).toBe(true);
  });
  it("rejects an empty usage list or a bad quantity", () => {
    expect(clientUsageSchema.safeParse({ client_ref: "x", period_month: "2026-02", usage: [] }).success).toBe(false);
    expect(clientUsageSchema.safeParse({ client_ref: "x", period_month: "2026-02", usage: [{ item_type: "tu_call_report", quantity: -1 }] }).success).toBe(false);
  });
});

describe("usageShapeError (A4)", () => {
  it("rejects value on a count-based metric and principal where it doesn't belong", () => {
    expect(usageShapeError("per_request", { quantity: 10, value: 5 })).toMatch(/value posted/);
    expect(usageShapeError("per_message", { quantity: 10, principal: 5 })).toMatch(/principal posted/);
  });
  it("requires value for per_txn_pct and principal for pct_of_principal", () => {
    expect(usageShapeError("per_txn_pct", { quantity: 1 })).toMatch(/needs a pre-computed value/);
    expect(usageShapeError("pct_of_principal", { quantity: 5 })).toMatch(/needs principal/);
  });
  it("allows the correct shapes", () => {
    expect(usageShapeError("per_txn_fixed_and_pct", { quantity: 100, value: 95000 })).toBeNull();
    expect(usageShapeError("per_txn_fixed", { quantity: 1000 })).toBeNull();
    expect(usageShapeError("pct_of_principal", { quantity: 42, principal: 85000000 })).toBeNull();
    expect(usageShapeError("per_request", { quantity: 250 })).toBeNull();
  });
});

describe("validateUsageBatch (A1/A2/A4)", () => {
  it("flags an unknown item_type (A1) — e.g. tu_call_report, which doesn't exist (only _qs/_ca)", () => {
    const d = validateUsageBatch([{ item_type: "tu_call_report", quantity: 100 }]);
    expect(d.unknown).toEqual(["tu_call_report"]);
    expect(usageBatchHasErrors(d)).toBe(true);
  });
  it("flags a value over the ceiling (A2)", () => {
    const d = validateUsageBatch([{ item_type: "pay_by_bank", quantity: 1, value: 600_000_000 }]); // £6,000,000 > £5,000,000
    expect(d.over_ceiling).toHaveLength(1);
    expect(d.over_ceiling[0]).toMatchObject({ item_type: "pay_by_bank", field: "value" });
  });
  it("flags a bad metric shape (A4) — value on faster_payments (per_txn_fixed)", () => {
    const d = validateUsageBatch([{ item_type: "faster_payments", quantity: 500, value: 10 }]);
    expect(d.bad_shape).toHaveLength(1);
  });
  it("passes a clean batch", () => {
    const d = validateUsageBatch([
      { item_type: "tu_callml", quantity: 250 },
      { item_type: "pay_by_bank", quantity: 100, value: 95000 },
      { item_type: "monevo_broker_fee", quantity: 42, principal: 85_000_000 },
    ]);
    expect(usageBatchHasErrors(d)).toBe(false);
  });
});
