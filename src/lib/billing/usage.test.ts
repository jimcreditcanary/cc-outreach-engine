import { describe, it, expect } from "vitest";
import { normalizePeriodMonth, usagePayloadEqual, usageBodySchema } from "./usage";

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
