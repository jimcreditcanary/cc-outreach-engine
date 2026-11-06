import { describe, it, expect } from "vitest";
import { itemInScope, scopeReason } from "./offering";
import { catalogueEntry } from "./catalogue";

const entry = (key: string) => {
  const e = catalogueEntry(key);
  if (!e) throw new Error(`no catalogue entry ${key}`);
  return e;
};

describe("itemInScope", () => {
  it("core and comms are always offered", () => {
    expect(itemInScope(entry("setup_fee"), [])).toBe(true);
    expect(itemInScope(entry("comms_sms"), [])).toBe(true);
    expect(itemInScope(entry("comms_sms_numbers"), [])).toBe(true); // C1 row, comms group
  });

  it("other items need the matching onboarding product group", () => {
    expect(itemInScope(entry("open_banking_ais"), [])).toBe(false);
    expect(itemInScope(entry("open_banking_ais"), ["open_banking_data"])).toBe(true);
  });

  it("faster_payments is unlocked by settlement_accounts", () => {
    expect(itemInScope(entry("faster_payments"), [])).toBe(false);
    expect(itemInScope(entry("faster_payments"), ["settlement_accounts"])).toBe(true);
  });

  it("scopeReason names the needed group", () => {
    expect(scopeReason(entry("open_banking_ais"))).toContain("open_banking_data");
  });
});
