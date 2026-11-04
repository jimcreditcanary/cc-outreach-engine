import { describe, it, expect } from "vitest";
import { parseIxbrl } from "./ixbrl";

// Minimal but realistic iXBRL: two periods, scale + sign, instant + duration
// contexts. The prior-year turnover must NOT win over the latest period.
const SAMPLE = `
<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance">
<body>
<ix:header><ix:resources>
  <xbrli:context id="cur"><xbrli:entity/><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="prev"><xbrli:entity/><xbrli:period><xbrli:startDate>2023-04-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="curInstant"><xbrli:entity/><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>
  <xbrli:context id="prevInstant"><xbrli:entity/><xbrli:period><xbrli:instant>2024-03-31</xbrli:instant></xbrli:period></xbrli:context>
</ix:resources></ix:header>
<p>Turnover <ix:nonFraction name="core:TurnoverRevenue" contextRef="cur" unitRef="GBP" scale="3" decimals="0">1,250</ix:nonFraction></p>
<p>Prior turnover <ix:nonFraction name="core:TurnoverRevenue" contextRef="prev" unitRef="GBP" scale="3">1,100</ix:nonFraction></p>
<p>Profit <ix:nonFraction name="core:ProfitLoss" contextRef="cur" unitRef="GBP" sign="-" decimals="0">45000</ix:nonFraction></p>
<p>Net assets <ix:nonFraction name="core:NetAssetsLiabilities" contextRef="curInstant" unitRef="GBP">320000</ix:nonFraction></p>
<p>Cash <ix:nonFraction name="core:CashBankOnHand" contextRef="curInstant" unitRef="GBP">88,000</ix:nonFraction></p>
<p>Current assets <ix:nonFraction name="core:CurrentAssets" contextRef="curInstant" unitRef="GBP">410000</ix:nonFraction></p>
<p>Current liabilities <ix:nonFraction name="core:CreditorsDueWithinOneYear" contextRef="curInstant" unitRef="GBP">150000</ix:nonFraction></p>
<p>Net current assets <ix:nonFraction name="core:NetCurrentAssetsLiabilities" contextRef="curInstant" unitRef="GBP">260000</ix:nonFraction></p>
<p>Prior current assets <ix:nonFraction name="core:CurrentAssets" contextRef="prevInstant" unitRef="GBP">360000</ix:nonFraction></p>
<p>Prior current liabilities <ix:nonFraction name="core:CreditorsDueWithinOneYear" contextRef="prevInstant" unitRef="GBP">180000</ix:nonFraction></p>
<p>Employees <ix:nonFraction name="core:AverageNumberEmployeesDuringPeriod" contextRef="cur" unitRef="pure">12</ix:nonFraction></p>
</body></html>`;

describe("iXBRL accounts parser", () => {
  const out = parseIxbrl(SAMPLE);

  it("uses the latest period end", () => {
    expect(out.periodEnd).toBe("2025-03-31");
  });

  it("applies scale and picks the current-period turnover (not prior year)", () => {
    expect(out.turnover).toBe(1_250_000);
  });

  it("applies the negative sign to profit/loss", () => {
    expect(out.profit_loss).toBe(-45_000);
  });

  it("extracts net assets, cash (with commas) and employees", () => {
    expect(out.net_assets).toBe(320_000);
    expect(out.cash).toBe(88_000);
    expect(out.employees).toBe(12);
  });

  it("keeps all raw facts", () => {
    expect(out.facts.length).toBeGreaterThanOrEqual(6);
  });

  it("extracts two-year working capital, newest first, without confusing current vs net current assets", () => {
    expect(out.periods).toHaveLength(2);
    const [latest, prior] = out.periods;
    expect(latest!.period_end).toBe("2025-03-31");
    expect(latest!.current_assets).toBe(410_000); // not 260_000 (net current assets)
    expect(latest!.current_liabilities).toBe(150_000);
    expect(latest!.net_current_assets).toBe(260_000);
    expect(prior!.period_end).toBe("2024-03-31");
    expect(prior!.current_assets).toBe(360_000);
    expect(prior!.current_liabilities).toBe(180_000);
    expect(prior!.net_current_assets).toBeNull(); // prior net current assets not filed
  });

  it("returns nulls on non-iXBRL input without throwing", () => {
    const empty = parseIxbrl("<html><body>no facts here</body></html>");
    expect(empty.turnover).toBeNull();
    expect(empty.facts).toEqual([]);
  });
});
