// Billing home — list of billing accounts (Phase 1). The full setup wizard and
// invoice views arrive in later phases; this is the landing page the deal-owner
// email and the Company "Set up billing" button point into.

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { listBillingAccounts } from "@/lib/billing/repo";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  setup_pending: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-700",
  notice_given: "bg-orange-100 text-orange-700",
  cancelled: "bg-neutral-200 text-neutral-600",
  disputed: "bg-red-100 text-red-700",
};

export default async function BillingHome() {
  const accounts = await listBillingAccounts(serviceClient());
  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Billing</h1>
        <div className="flex items-baseline gap-3 text-sm">
          <Link href="/billing/outstanding" className="text-blue-600 hover:underline">Outstanding →</Link>
          <span className="text-neutral-500">{accounts.length} account{accounts.length === 1 ? "" : "s"}</span>
        </div>
      </header>

      {accounts.length === 0 ? (
        <p className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          No billing accounts yet — one is created automatically when an onboarding case is approved.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2">Company</th>
              <th className="py-2">Status</th>
              <th className="py-2">Created</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-neutral-100">
                <td className="py-2">{a.hubspot_company_id ?? "—"}</td>
                <td className="py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[a.status] ?? "bg-neutral-100 text-neutral-600"}`}>{a.status}</span>
                </td>
                <td className="py-2 text-neutral-500">{fmtDate(a.created_at)}</td>
                <td className="py-2 text-right"><Link href={`/billing/${a.id}`} className="text-blue-600 hover:underline">View →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
