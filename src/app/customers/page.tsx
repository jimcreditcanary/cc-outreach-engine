// Customers — companies explicitly flagged as customers (migration 064). One row
// per customer with its onboarding + billing status and the id; click through to
// the per-customer view that aggregates onboarding outputs and billing history.
// Mark a company a customer from its company page.

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { companyNames } from "@/lib/hubspot/repo";
import { listCustomerCompanyIds } from "@/lib/crm/customer";
import { formatPence } from "@/lib/billing/money";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const ONB_STYLE: Record<string, string> = {
  onboarded: "bg-emerald-100 text-emerald-700",
  started: "bg-amber-100 text-amber-800",
  cancelled: "bg-neutral-200 text-neutral-600",
};
const BILL_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  setup_pending: "bg-amber-100 text-amber-800",
  notice_given: "bg-orange-100 text-orange-700",
  cancelled: "bg-neutral-200 text-neutral-600",
  disputed: "bg-red-100 text-red-700",
};

export default async function CustomersPage() {
  const db = serviceClient();
  // Source of truth: companies flagged as Active Customers here (the button),
  // NOT HubSpot current_client. Names are resolved from HubSpot by id.
  const ids = await listCustomerCompanyIds(db);
  const nameFor = await companyNames(ids);

  const grab = async <T,>(table: string, cols: string, col: string, vals: string[]): Promise<T[]> => {
    if (!vals.length) return [];
    const { data } = await db.from(table).select(cols).in(col, vals);
    return (data ?? []) as T[];
  };
  const [cases, accounts, invoices] = await Promise.all([
    grab<{ hubspot_company_id: string | null; status: string; updated_at: string }>("onboarding_cases", "hubspot_company_id, status, updated_at", "hubspot_company_id", ids),
    grab<{ id: string; hubspot_company_id: string | null; status: string }>("billing_accounts", "id, hubspot_company_id, status", "hubspot_company_id", ids),
    (async () => {
      const acctIds = (await grab<{ id: string; hubspot_company_id: string | null }>("billing_accounts", "id, hubspot_company_id", "hubspot_company_id", ids));
      const accountToCompany = new Map(acctIds.map((a) => [a.id, a.hubspot_company_id]));
      if (!acctIds.length) return [] as { company_id: string | null; total_pence: number; period_month: string }[];
      const { data } = await db.from("billing_invoices").select("account_id, total_pence, period_month").in("account_id", acctIds.map((a) => a.id));
      return ((data ?? []) as { account_id: string; total_pence: number; period_month: string }[]).map((inv) => ({ company_id: accountToCompany.get(inv.account_id) ?? null, total_pence: inv.total_pence, period_month: inv.period_month }));
    })(),
  ]);

  const latestCase = new Map<string, string>();
  for (const c of [...cases].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) if (c.hubspot_company_id) latestCase.set(c.hubspot_company_id, c.status);
  const acctFor = new Map(accounts.filter((a) => a.hubspot_company_id).map((a) => [a.hubspot_company_id!, a]));
  const lastInvoice = new Map<string, { total_pence: number; period_month: string }>();
  for (const inv of [...invoices].sort((a, b) => a.period_month.localeCompare(b.period_month))) if (inv.company_id) lastInvoice.set(inv.company_id, { total_pence: inv.total_pence, period_month: inv.period_month });

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Customers</h1>
        <span className="text-sm text-neutral-500">{ids.length} customer{ids.length === 1 ? "" : "s"}</span>
      </header>

      {ids.length === 0 ? (
        <p className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          No customers yet — open a company and click <strong>Mark as Active Customer</strong>.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2">Customer</th>
              <th className="py-2">Onboarding</th>
              <th className="py-2">Billing</th>
              <th className="py-2">Last invoice</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const onb = latestCase.get(id);
              const acct = acctFor.get(id);
              const inv = lastInvoice.get(id);
              return (
                <tr key={id} className="border-b border-neutral-100">
                  <td className="py-2">
                    <div className="font-medium">{nameFor.get(id) ?? id}</div>
                    <div className="font-mono text-xs text-neutral-400">{id}</div>
                  </td>
                  <td className="py-2">{onb ? <span className={`rounded px-1.5 py-0.5 text-xs ${ONB_STYLE[onb] ?? "bg-neutral-100 text-neutral-600"}`}>{onb}</span> : <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2">{acct ? <span className={`rounded px-1.5 py-0.5 text-xs ${BILL_STYLE[acct.status] ?? "bg-neutral-100 text-neutral-600"}`}>{acct.status}</span> : <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2 text-neutral-600">{inv ? `${formatPence(inv.total_pence)} · ${inv.period_month.slice(0, 7)}` : "—"}</td>
                  <td className="py-2 text-right"><Link href={`/companies/${id}`} className="text-blue-600 hover:underline">View →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-neutral-400">Mark/unmark a company as a customer from its company page. Updated {fmtDate(new Date())}.</p>
    </main>
  );
}
