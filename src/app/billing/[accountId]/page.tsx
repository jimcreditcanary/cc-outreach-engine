// Billing account detail (Phase 1). Shows the account, the mirrored HubSpot
// deal line items, and a placeholder for the Phase-2 setup wizard.

import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getBillingAccountById } from "@/lib/billing/repo";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function BillingAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceClient();
  const account = await getBillingAccountById(db, accountId);
  if (!account) notFound();

  const { data: lineItems } = await db
    .from("billing_hubspot_line_items_mirror")
    .select("id, name, sku, quantity, price, amount, term")
    .eq("account_id", accountId)
    .order("mirrored_at", { ascending: true });

  const row = "flex justify-between border-b border-neutral-100 py-1.5 text-sm";
  const key = "text-neutral-500";

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href="/billing" className="text-sm text-neutral-500 hover:underline">← Billing</Link>
      <header className="mt-2 mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Billing account</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{account.status}</span>
      </header>

      <section className="max-w-xl">
        <div className={row}><span className={key}>Company (HubSpot)</span><span>{account.hubspot_company_id ?? "—"}</span></div>
        <div className={row}><span className={key}>Deal (HubSpot)</span><span>{account.hubspot_deal_id ?? "—"}</span></div>
        <div className={row}><span className={key}>Onboarding case</span><span>{account.onboarding_case_id ? <Link className="text-blue-600 hover:underline" href={`/onboarding/${account.onboarding_case_id}/review`}>view</Link> : "—"}</span></div>
        <div className={row}><span className={key}>Finance contact (HubSpot)</span><span>{account.finance_contact_id ?? "—"}</span></div>
        <div className={row}><span className={key}>Xero contact</span><span>{account.xero_contact_id ?? "— (Phase 4)"}</span></div>
        <div className={row}><span className={key}>Contract start</span><span>{account.contract_start_date ? fmtDate(account.contract_start_date) : "—"}</span></div>
        <div className={row}><span className={key}>Created</span><span>{fmtDate(account.created_at)}</span></div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">HubSpot line items (mirror, read-only)</h2>
        {!lineItems?.length ? (
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
            None mirrored — the deal has no line items, or the HubSpot token lacks line-item read scope.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr><th className="py-1.5">Name</th><th>SKU</th><th>Qty</th><th>Price</th><th>Amount</th><th>Term</th></tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id} className="border-b border-neutral-100">
                  <td className="py-1.5">{li.name ?? "—"}</td><td>{li.sku ?? "—"}</td><td>{li.quantity ?? "—"}</td>
                  <td>{li.price ?? "—"}</td><td>{li.amount ?? "—"}</td><td>{li.term ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-3 text-sm text-neutral-600">
        The billing <strong>setup wizard</strong> (products, pricing, contract terms, first-invoice preview) and the
        monthly invoice run arrive in the next phases. This account is <strong>{account.status}</strong>.
      </section>
    </main>
  );
}
