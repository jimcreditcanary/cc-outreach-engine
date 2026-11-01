// Customers — the account-level overview Jim asked for: status, onboarding
// outcome, products, billing, late payments (once Xero's on), the id, and a
// quick "were we accurate?" verdict comparing what we set up vs the HubSpot
// deal line items. Per-customer detail (full reconciliation) is on /billing/[id].

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { listBillingAccounts, currentPricingByItemType } from "@/lib/billing/repo";
import { reconcile, type DealLine, type ConfiguredItem } from "@/lib/billing/reconcile";
import { formatPence } from "@/lib/billing/money";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  setup_pending: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-700",
  notice_given: "bg-orange-100 text-orange-700",
  cancelled: "bg-neutral-200 text-neutral-600",
  disputed: "bg-red-100 text-red-700",
};

const today = () => new Date().toISOString().slice(0, 10);

export default async function CustomersPage() {
  const db = serviceClient();
  const accounts = await listBillingAccounts(db);
  const ids = accounts.map((a) => a.id);
  const caseIds = [...new Set(accounts.map((a) => a.onboarding_case_id).filter(Boolean) as string[])];
  const companyIds = [...new Set(accounts.map((a) => a.hubspot_company_id).filter(Boolean) as string[])];

  const pricing = await currentPricingByItemType(db);
  const knownKeys = new Set(pricing.keys());

  const grab = async <T,>(table: string, cols: string, col: string, vals: string[]): Promise<T[]> => {
    if (!vals.length) return [];
    const { data } = await db.from(table).select(cols).in(col, vals);
    return (data ?? []) as T[];
  };
  const [itemRows, mirrorRows, caseRows, invoiceRows, nameRows] = await Promise.all([
    grab<{ account_id: string; item_type: string; active: boolean }>("billing_items", "account_id, item_type, active", "account_id", ids),
    grab<{ account_id: string; sku: string | null; name: string | null; quantity: number | null; price: number | null }>("billing_hubspot_line_items_mirror", "account_id, sku, name, quantity, price", "account_id", ids),
    grab<{ id: string; status: string }>("onboarding_cases", "id, status", "id", caseIds),
    grab<{ account_id: string; total_pence: number; due_date: string | null; paid_at: string | null; period_month: string }>("billing_invoices", "account_id, total_pence, due_date, paid_at, period_month", "account_id", ids),
    grab<{ id: string; name: string | null }>("hs_mirror_companies", "id, name", "id", companyIds),
  ]);

  const byAcct = <T extends { account_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.account_id) ?? m.set(r.account_id, []).get(r.account_id)!).push(r);
    return m;
  };
  const items = byAcct(itemRows), mirror = byAcct(mirrorRows), invoices = byAcct(invoiceRows);
  const caseStatus = new Map(caseRows.map((c) => [c.id, c.status]));
  const names = new Map(nameRows.filter((n) => n.name).map((n) => [n.id, n.name!]));
  const td = today();

  const rows = accounts.map((a) => {
    const configured: ConfiguredItem[] = (items.get(a.id) ?? []).filter((i) => i.active).map((i) => ({
      item_type: i.item_type, label: pricing.get(i.item_type)?.name ?? i.item_type, our_price_pence: null,
    }));
    const dealLines: DealLine[] = (mirror.get(a.id) ?? []).map((li) => ({ sku: li.sku, name: li.name, quantity: li.quantity, price: li.price }));
    const recon = reconcile(dealLines, configured, { knownKeys });

    const invs = (invoices.get(a.id) ?? []).sort((x, y) => y.period_month.localeCompare(x.period_month));
    const last = invs[0];
    const overdue = invs.filter((i) => !i.paid_at && i.due_date && i.due_date < td);

    return { a, configured, dealLines, recon, outcome: a.onboarding_case_id ? caseStatus.get(a.onboarding_case_id) ?? null : null, last, overdueCount: overdue.length };
  });

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Customers</h1>
        <div className="flex items-baseline gap-3 text-sm">
          <Link href="/billing" className="text-blue-600 hover:underline">Accounts →</Link>
          <Link href="/billing/outstanding" className="text-blue-600 hover:underline">Outstanding →</Link>
          <span className="text-neutral-500">{accounts.length} customer{accounts.length === 1 ? "" : "s"}</span>
        </div>
      </header>

      {accounts.length === 0 ? (
        <p className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">No customers yet — a billing account is created when an onboarding case is approved.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2">Customer</th>
              <th className="py-2">Status</th>
              <th className="py-2">Onboarding</th>
              <th className="py-2">Products</th>
              <th className="py-2">Deal match</th>
              <th className="py-2">Last invoice</th>
              <th className="py-2">Overdue</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, configured, dealLines, recon, outcome, last, overdueCount }) => (
              <tr key={a.id} className="border-b border-neutral-100 align-top">
                <td className="py-2">
                  <div className="font-medium">{a.hubspot_company_id ? names.get(a.hubspot_company_id) ?? a.hubspot_company_id : a.id.slice(0, 8)}</div>
                  <div className="font-mono text-xs text-neutral-400">{a.hubspot_company_id ?? a.id.slice(0, 8)}</div>
                </td>
                <td className="py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[a.status] ?? "bg-neutral-100 text-neutral-600"}`}>{a.status}</span></td>
                <td className="py-2 text-neutral-600">{outcome ?? "—"}</td>
                <td className="py-2 text-neutral-600">{configured.length}</td>
                <td className="py-2">
                  {dealLines.length === 0 ? (
                    <span className="text-xs text-neutral-400">no deal lines</span>
                  ) : recon.accurate ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">✓ accurate</span>
                  ) : (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">⚠ {recon.issues} to check</span>
                  )}
                </td>
                <td className="py-2 text-neutral-600">{last ? `${formatPence(last.total_pence)} · ${last.period_month.slice(0, 7)}` : "—"}</td>
                <td className="py-2">{overdueCount > 0 ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">{overdueCount}</span> : <span className="text-neutral-400">—</span>}</td>
                <td className="py-2 text-right"><Link href={`/billing/${a.id}`} className="text-blue-600 hover:underline">View →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
