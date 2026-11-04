// Phase 2b — fetch + parse the company's latest filed accounts (iXBRL via the
// Companies House Document API) and store the headline figures. Team-triggered,
// re-runnable. Advisory — extracted figures are a convenience, not a substitute
// for the filed accounts themselves.

import type { serviceClient } from "../db/client";
import { getCompaniesHouse } from "../integrations/companiesHouse";
import { parseIxbrl, type AccountsPeriod } from "./ixbrl";
import { getCase, logCaseEvent } from "./cases";

type DB = ReturnType<typeof serviceClient>;

export interface StoredAccounts {
  period_end: string | null;
  turnover: number | null;
  profit_loss: number | null;
  net_assets: number | null;
  cash: number | null;
  employees: number | null;
  /** Two-year working capital (B5). Absent before migration 070. */
  periods: AccountsPeriod[] | null;
  parsed_at: string | null;
}

const CORE_COLS = "period_end, turnover, profit_loss, net_assets, cash, employees, parsed_at";

export async function loadAccounts(db: DB, caseId: string): Promise<StoredAccounts | null> {
  try {
    // Try with the B5 `periods` column; fall back to the core columns when it
    // isn't there yet (migration 070 not applied) so accounts still render.
    let res = await db.from("onboarding_accounts").select(`${CORE_COLS}, periods`).eq("case_id", caseId).maybeSingle();
    if (res.error) res = await db.from("onboarding_accounts").select(CORE_COLS).eq("case_id", caseId).maybeSingle();
    const row = res.data as (Omit<StoredAccounts, "periods"> & { periods?: AccountsPeriod[] | null }) | null;
    return row ? { ...row, periods: row.periods ?? null } : null;
  } catch {
    return null;
  }
}

export async function parseAccountsForCase(db: DB, caseId: string, actor: { id?: string | null; email?: string | null }): Promise<StoredAccounts> {
  const c = await getCase(db, caseId);
  if (!c?.company_number) throw new Error("Confirm the company (step 1) before parsing accounts.");

  const doc = await getCompaniesHouse().getAccountsDocument(c.company_number);
  if (!doc) throw new Error("No machine-readable (iXBRL) accounts are available for this company — check the filed PDF manually.");

  const parsed = parseIxbrl(doc.ixbrl);
  const row: StoredAccounts = {
    period_end: parsed.periodEnd ?? doc.madeUpTo,
    turnover: parsed.turnover,
    profit_loss: parsed.profit_loss,
    net_assets: parsed.net_assets,
    cash: parsed.cash,
    employees: parsed.employees != null ? Math.round(parsed.employees) : null,
    periods: parsed.periods,
    parsed_at: new Date().toISOString(),
  };

  // Upsert with the B5 `periods` column; retry without it when migration 070
  // hasn't been applied (unknown-column error) so parsing never hard-fails.
  const { periods, ...core } = row;
  const full = { case_id: caseId, ...core, periods, facts: parsed.facts };
  let up = await db.from("onboarding_accounts").upsert(full, { onConflict: "case_id" });
  if (up.error) up = await db.from("onboarding_accounts").upsert({ case_id: caseId, ...core, facts: parsed.facts }, { onConflict: "case_id" });
  await logCaseEvent(db, caseId, "accounts_parsed", actor, { period_end: row.period_end, facts: parsed.facts.length, periods: parsed.periods.length });
  return row;
}
