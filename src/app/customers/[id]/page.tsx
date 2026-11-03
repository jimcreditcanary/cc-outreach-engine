// Per-customer view (id = HubSpot company id). Aggregates the company's
// onboarding outputs (case status + products + generated documents) and billing
// history (account status + invoices) in one place, with links through to the
// onboarding wizard, the billing account, and the company page.

import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getCrm } from "@/lib/crm";
import { toggleCustomerAction } from "../../companies/hubspotActions";
import { formatPence } from "@/lib/billing/money";
import { fmtDate } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";

const row = "flex items-center justify-between border-b border-neutral-100 py-1.5 text-sm";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = serviceClient();

  const [co, { data: cases }, { data: accounts }] = await Promise.all([
    getCrm().getCompany(id).catch(() => null),
    db.from("onboarding_cases").select("id, status, product_groups, hubspot_deal_id, updated_at").eq("hubspot_company_id", id).order("updated_at", { ascending: false }),
    db.from("billing_accounts").select("id, status, contract_start_date").eq("hubspot_company_id", id).order("created_at", { ascending: false }),
  ]);
  // Customer status IS current_client (single source of truth).
  const customer = co?.current_client === true;

  // Nothing links this company to a customer record, onboarding, or billing.
  if (!customer && !(cases?.length) && !(accounts?.length)) notFound();

  const caseIds = (cases ?? []).map((c) => c.id);
  const acctIds = (accounts ?? []).map((a) => a.id);
  const [{ data: docs }, { data: invoices }] = await Promise.all([
    caseIds.length ? db.from("onboarding_generated_docs").select("case_id, doc_kind, filename, generated_at").in("case_id", caseIds).order("generated_at", { ascending: false }) : Promise.resolve({ data: [] }),
    acctIds.length ? db.from("billing_invoices").select("account_id, period_month, total_pence, xero_status, due_date, paid_at").in("account_id", acctIds).order("period_month", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const docsByCase = new Map<string, { doc_kind: string; filename: string; generated_at: string }[]>();
  for (const d of (docs ?? []) as { case_id: string; doc_kind: string; filename: string; generated_at: string }[]) {
    (docsByCase.get(d.case_id) ?? docsByCase.set(d.case_id, []).get(d.case_id)!).push(d);
  }
  const invByAcct = new Map<string, { period_month: string; total_pence: number; xero_status: string | null; due_date: string | null; paid_at: string | null }[]>();
  for (const inv of (invoices ?? []) as { account_id: string; period_month: string; total_pence: number; xero_status: string | null; due_date: string | null; paid_at: string | null }[]) {
    (invByAcct.get(inv.account_id) ?? invByAcct.set(inv.account_id, []).get(inv.account_id)!).push(inv);
  }

  const name = co?.name ?? id;

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href="/customers" className="text-sm text-neutral-500 hover:underline">← Customers</Link>
      <header className="mt-2 mb-5 flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">{name}</h1>
        {customer && <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Customer</span>}
        <span className="font-mono text-xs text-neutral-400">{id}</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/companies/${id}`} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100">Company page →</Link>
          <form action={toggleCustomerAction}>
            <input type="hidden" name="company_id" value={id} />
            <input type="hidden" name="on" value={customer ? "false" : "true"} />
            <PendingButton className={`rounded border px-2 py-0.5 text-xs ${customer ? "border-neutral-300 text-neutral-500 hover:bg-neutral-100" : "border-teal-400 text-teal-700 hover:bg-teal-50"}`} pendingLabel="…">
              {customer ? "Unmark customer" : "Mark as Customer"}
            </PendingButton>
          </form>
        </div>
      </header>

      {/* Onboarding */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Onboarding</h2>
        {!(cases?.length) ? (
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">No onboarding case for this company.</p>
        ) : (
          <div className="space-y-3">
            {(cases ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{c.status}</span>
                  <span className="text-neutral-500">updated {fmtDate(c.updated_at)}</span>
                  {(c.product_groups ?? []).length > 0 && <span className="text-neutral-600">· {(c.product_groups as string[]).join(", ")}</span>}
                  <Link href={`/onboarding/${c.id}`} className="ml-auto text-blue-600 hover:underline">Open case →</Link>
                </div>
                {(docsByCase.get(c.id)?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                    {docsByCase.get(c.id)!.map((d, i) => (
                      <li key={i} className="flex items-center justify-between">
                        <span>📄 {d.filename} <span className="text-neutral-400">({d.doc_kind})</span></span>
                        <span className="text-neutral-400">{fmtDate(d.generated_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Billing */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Billing</h2>
        {!(accounts?.length) ? (
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">No billing account for this company.</p>
        ) : (
          <div className="space-y-3">
            {(accounts ?? []).map((a) => {
              const invs = invByAcct.get(a.id) ?? [];
              return (
                <div key={a.id} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{a.status}</span>
                    {a.contract_start_date && <span className="text-neutral-500">from {fmtDate(a.contract_start_date)}</span>}
                    <Link href={`/billing/${a.id}`} className="ml-auto text-blue-600 hover:underline">Open billing →</Link>
                  </div>
                  {invs.length === 0 ? (
                    <p className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-400">No invoices raised yet.</p>
                  ) : (
                    <table className="mt-2 w-full border-t border-neutral-100 pt-2 text-xs">
                      <thead className="text-left text-neutral-400"><tr><th className="py-1">Period</th><th>Total</th><th>Status</th><th>Due</th></tr></thead>
                      <tbody>
                        {invs.map((inv, i) => (
                          <tr key={i} className="border-t border-neutral-50">
                            <td className="py-1">{inv.period_month.slice(0, 7)}</td>
                            <td>{formatPence(inv.total_pence)}</td>
                            <td>{inv.paid_at ? <span className="text-emerald-600">paid</span> : (inv.xero_status ?? "—")}</td>
                            <td className="text-neutral-500">{inv.due_date ? fmtDate(inv.due_date) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
