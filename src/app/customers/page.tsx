// Customers + onboarding, merged into one list (feedback item 1). One row per
// company that is either flagged an Active Customer OR has an onboarding case,
// showing onboarding status + progress, last-updated, billing status and the
// last / next invoice. Rows link to the company's Onboarding tab (where the case
// now lives). Cancelled cases are excluded. Mark a company a customer, or start
// onboarding, from its company page.

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

// Five headline onboarding stages for the progress bar (from the old tracker).
const STAGES = ["Internal", "Merchant", "Checks", "Docs", "Onboarded"];
const COMPLETED_BY_STATUS: Record<string, number> = {
  started: 0, internal_complete: 1, merchant_invited: 1, merchant_in_progress: 1,
  merchant_submitted: 2, ubo_checks: 3, docs_generated: 4, awaiting_approval: 4, onboarded: 5, cancelled: 0,
};
function StageBar({ status }: { status: string | null }) {
  const done = status ? COMPLETED_BY_STATUS[status] ?? 0 : 0;
  return (
    <div className="flex items-center gap-1" title={status ? STAGES[Math.min(done, STAGES.length - 1)] : "not started"}>
      {STAGES.map((label, i) => <span key={label} className={`h-1.5 w-5 rounded-full ${i < done ? "bg-emerald-500" : "bg-neutral-200"}`} aria-label={label} />)}
    </div>
  );
}

/** Forward estimate of the next invoice: the month after the last one, at the
 *  same amount (invoices aren't pre-generated, so this is an estimate). */
function nextInvoice(last: { total_pence: number; period_month: string } | undefined): string {
  if (!last) return "—";
  const d = new Date(last.period_month);
  if (Number.isNaN(d.getTime())) return "—";
  d.setUTCMonth(d.getUTCMonth() + 1);
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `~${formatPence(last.total_pence)} · ${ym}`;
}

interface CaseRow { id: string; hubspot_company_id: string | null; company_number: string | null; status: string; updated_at: string }

export default async function CustomersPage() {
  const db = serviceClient();

  const grab = async <T,>(table: string, cols: string, col: string, vals: string[]): Promise<T[]> => {
    if (!vals.length) return [];
    const { data } = await db.from(table).select(cols).in(col, vals);
    return (data ?? []) as T[];
  };

  // Row set = Active-Customer-flagged companies ∪ companies with a live case.
  const [customerIds, allCases] = await Promise.all([
    listCustomerCompanyIds(db),
    (async () => {
      const { data } = await db
        .from("onboarding_cases")
        .select("id, hubspot_company_id, company_number, status, updated_at")
        .neq("status", "cancelled")
        .order("updated_at", { ascending: false })
        .limit(500);
      return (data ?? []) as CaseRow[];
    })(),
  ]);

  // Latest live case per company (allCases is newest-first, so first wins).
  const latestCaseByCompany = new Map<string, CaseRow>();
  const orphanCases: CaseRow[] = [];
  for (const c of allCases) {
    if (c.hubspot_company_id) { if (!latestCaseByCompany.has(c.hubspot_company_id)) latestCaseByCompany.set(c.hubspot_company_id, c); }
    else orphanCases.push(c);
  }

  const ids = [...new Set([...customerIds, ...latestCaseByCompany.keys()])];
  const nameFor = await companyNames(ids);

  const accounts = await grab<{ id: string; hubspot_company_id: string | null; status: string }>("billing_accounts", "id, hubspot_company_id, status", "hubspot_company_id", ids);
  const acctFor = new Map(accounts.filter((a) => a.hubspot_company_id).map((a) => [a.hubspot_company_id!, a]));
  const acctIds = accounts.map((a) => a.id);
  const invoices = acctIds.length
    ? (async () => {
        const { data } = await db.from("billing_invoices").select("account_id, total_pence, period_month").in("account_id", acctIds);
        const accountToCompany = new Map(accounts.map((a) => [a.id, a.hubspot_company_id]));
        return ((data ?? []) as { account_id: string; total_pence: number; period_month: string }[])
          .map((inv) => ({ company_id: accountToCompany.get(inv.account_id) ?? null, total_pence: inv.total_pence, period_month: inv.period_month }));
      })()
    : Promise.resolve([] as { company_id: string | null; total_pence: number; period_month: string }[]);
  const invList = await invoices;
  const lastInvoice = new Map<string, { total_pence: number; period_month: string }>();
  for (const inv of [...invList].sort((a, b) => a.period_month.localeCompare(b.period_month))) if (inv.company_id) lastInvoice.set(inv.company_id, { total_pence: inv.total_pence, period_month: inv.period_month });

  // Sort: in-progress onboardings first, then by latest activity, customers last.
  const rowIds = [...ids].sort((a, b) => {
    const ca = latestCaseByCompany.get(a), cb = latestCaseByCompany.get(b);
    return (cb?.updated_at ?? "").localeCompare(ca?.updated_at ?? "");
  });

  const total = rowIds.length + orphanCases.length;

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Customers &amp; onboarding</h1>
        <span className="text-sm text-neutral-500">{total} record{total === 1 ? "" : "s"}</span>
      </header>

      {total === 0 ? (
        <p className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          Nothing yet — open a company and click <strong>Mark as Active Customer</strong>, then start onboarding.
        </p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2">Company</th>
              <th className="py-2">Onboarding</th>
              <th className="py-2">Progress</th>
              <th className="py-2">Last updated</th>
              <th className="py-2">Billing</th>
              <th className="py-2">Last invoice</th>
              <th className="py-2">Next invoice</th>
            </tr>
          </thead>
          <tbody>
            {rowIds.map((id) => {
              const c = latestCaseByCompany.get(id);
              const onb = c?.status;
              const acct = acctFor.get(id);
              const inv = lastInvoice.get(id);
              const href = c ? `/companies/${id}?tab=onboarding` : `/companies/${id}`;
              return (
                <tr key={id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="py-2">
                    <Link href={href} className="font-medium text-blue-700 hover:underline">{nameFor.get(id) ?? id}</Link>
                    <div className="font-mono text-xs text-neutral-400">{id}</div>
                  </td>
                  <td className="py-2">{onb ? <span className={`rounded px-1.5 py-0.5 text-xs ${ONB_STYLE[onb] ?? "bg-neutral-100 text-neutral-600"}`}>{onb.replace(/_/g, " ")}</span> : <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2"><StageBar status={onb ?? null} /></td>
                  <td className="py-2 text-neutral-500">{c ? fmtDate(c.updated_at) : <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2">{acct ? <span className={`rounded px-1.5 py-0.5 text-xs ${BILL_STYLE[acct.status] ?? "bg-neutral-100 text-neutral-600"}`}>{acct.status.replace(/_/g, " ")}</span> : <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2 text-neutral-600">{inv ? `${formatPence(inv.total_pence)} · ${inv.period_month.slice(0, 7)}` : "—"}</td>
                  <td className="py-2 text-neutral-500">{nextInvoice(inv)}</td>
                </tr>
              );
            })}
            {orphanCases.map((c) => (
              <tr key={c.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="py-2"><Link href={`/onboarding/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.company_number ? `Company ${c.company_number}` : "(company not set)"}</Link></td>
                <td className="py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${ONB_STYLE[c.status] ?? "bg-neutral-100 text-neutral-600"}`}>{c.status.replace(/_/g, " ")}</span></td>
                <td className="py-2"><StageBar status={c.status} /></td>
                <td className="py-2 text-neutral-500">{fmtDate(c.updated_at)}</td>
                <td className="py-2 text-neutral-400">—</td>
                <td className="py-2 text-neutral-400">—</td>
                <td className="py-2 text-neutral-400">—</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="mt-3 text-xs text-neutral-400">Rows open the company&apos;s Onboarding tab. Mark/unmark a customer, or start onboarding, from its company page. &ldquo;Next invoice&rdquo; is an estimate (invoices are generated each billing run). Updated {fmtDate(new Date())}.</p>
    </main>
  );
}
