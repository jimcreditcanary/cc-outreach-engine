// Outstanding invoices (Phase 5 dunning). Overdue, unpaid invoices with a
// per-row "Contacted customer?" toggle + note → billing_dunning_log.

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { loadOutstanding } from "@/lib/billing/dunning";
import { formatPence } from "@/lib/billing/money";
import { fmtDate } from "@/lib/format/datetime";
import { markContactedAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function OutstandingPage() {
  const rows = await loadOutstanding(serviceClient());
  const totalDue = rows.reduce((s, r) => s + r.total_pence, 0);

  return (
    <main className="px-4 py-6 md:px-8">
      <div className="mb-2 flex items-baseline justify-between">
        <Link href="/billing" className="text-sm text-neutral-500 hover:underline">← Billing</Link>
      </div>
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Outstanding invoices</h1>
        <span className="text-sm text-neutral-500">{rows.length} overdue · {formatPence(totalDue)}</span>
      </header>

      {rows.length === 0 ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Nothing overdue — all invoices paid or within terms. ✅</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr><th className="py-2">Company</th><th>Period</th><th className="text-right">Amount</th><th>Due</th><th className="text-right">Days</th><th>Xero</th><th>Contacted?</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.invoice_id} className="border-b border-neutral-100 align-top">
                <td className="py-2">{r.company ?? r.account_id.slice(0, 8)}</td>
                <td className="py-2 text-neutral-500">{r.period_month.slice(0, 7)}</td>
                <td className="py-2 text-right">{formatPence(r.total_pence)}</td>
                <td className="py-2 text-neutral-500">{r.due_date ? fmtDate(r.due_date) : "—"}</td>
                <td className="py-2 text-right"><span className={r.days_overdue > 30 ? "text-red-600 font-medium" : "text-neutral-600"}>{r.days_overdue}</span></td>
                <td className="py-2">{r.xero_invoice_id ? <a href={`https://go.xero.com/app/invoices/edit/${r.xero_invoice_id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">open ↗</a> : "—"}</td>
                <td className="py-2">
                  <form action={markContactedAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="invoice_id" value={r.invoice_id} />
                    <input type="checkbox" name="contacted" defaultChecked={r.contacted_customer ?? false} title="Contacted customer?" />
                    <input name="note" defaultValue={r.note ?? ""} placeholder="note" className="w-36 rounded border border-neutral-300 px-2 py-1 text-xs" />
                    <button type="submit" className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
