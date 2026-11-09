// Dashboard data layer — billing actuals. Reads the billing invoice ledger so
// the Revenue dashboard can show what's actually been invoiced (and the live
// recurring run-rate) next to the booked deal figures. Amounts are stored in
// integer pence; we return pounds for charting.

import { serviceClient } from "@/lib/db/client";
import { monthKey } from "./deals";

export interface BillingMonth {
  month: string; // YYYY-MM
  invoiced: number; // £
  paid: number; // £
  outstanding: number; // £
}

export interface BillingRevenue {
  byMonth: BillingMonth[]; // chronological
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  mrr: number; // latest billed month's invoiced total, as a run-rate proxy (£)
  arr: number; // mrr × 12
  latestMonth: string | null;
  activeAccounts: number;
  hasAny: boolean;
}

const EMPTY: BillingRevenue = {
  byMonth: [], totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0,
  mrr: 0, arr: 0, latestMonth: null, activeAccounts: 0, hasAny: false,
};

function toMonthKey(periodMonth: string): string {
  // period_month is a DATE (YYYY-MM-DD). Keep YYYY-MM.
  const d = new Date(periodMonth.includes("T") ? periodMonth : `${periodMonth}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(periodMonth).slice(0, 7) : monthKey(d);
}

/** Invoiced-by-month, paid/outstanding, and a recurring run-rate proxy from the
 *  billing ledger. Best-effort: all-zero on failure. */
export async function loadBillingRevenue(): Promise<BillingRevenue> {
  try {
    const db = serviceClient();
    const [invRes, acctRes] = await Promise.all([
      db.from("billing_invoices").select("period_month, total_pence, paid_at").limit(10000),
      db.from("billing_accounts").select("id, status").limit(5000),
    ]);

    const rows = (invRes.data ?? []) as { period_month: string; total_pence: number | null; paid_at: string | null }[];
    if (rows.length === 0 && (acctRes.data ?? []).length === 0) return EMPTY;

    const months = new Map<string, BillingMonth>();
    let totalInvoiced = 0, totalPaid = 0, totalOutstanding = 0;
    for (const r of rows) {
      const key = toMonthKey(r.period_month);
      const amount = (r.total_pence ?? 0) / 100;
      const paid = r.paid_at ? amount : 0;
      const m = months.get(key) ?? { month: key, invoiced: 0, paid: 0, outstanding: 0 };
      m.invoiced += amount;
      m.paid += paid;
      m.outstanding += amount - paid;
      months.set(key, m);
      totalInvoiced += amount;
      totalPaid += paid;
      totalOutstanding += amount - paid;
    }

    const byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
    const latest = byMonth[byMonth.length - 1] ?? null;
    const mrr = latest ? latest.invoiced : 0;
    const activeAccounts = (acctRes.data ?? []).filter((a) => (a as { status?: string }).status === "active").length;

    return {
      byMonth,
      totalInvoiced, totalPaid, totalOutstanding,
      mrr, arr: mrr * 12,
      latestMonth: latest?.month ?? null,
      activeAccounts,
      hasAny: rows.length > 0 || activeAccounts > 0,
    };
  } catch {
    return EMPTY;
  }
}
