// Billing account detail (Phase 2). Account fields, configured items with their
// pricing config, a super-admin override panel, and the mirrored HubSpot line
// items.

import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getBillingAccountById, listBillingItems, currentPricingByItemType } from "@/lib/billing/repo";
import { labelFor, type Metric } from "@/lib/billing/catalogue";
import { describeConfig, type ItemConfig } from "@/lib/billing/itemConfig";
import { isSuperAdmin } from "@/lib/auth/role";
import { setItemOverrideAction } from "../actions";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function BillingAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceClient();
  const account = await getBillingAccountById(db, accountId);
  if (!account) notFound();

  const [items, pricing, superAdmin] = await Promise.all([
    listBillingItems(db, accountId),
    currentPricingByItemType(db),
    isSuperAdmin(),
  ]);
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
        <div className="flex items-center gap-2">
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{account.status}</span>
          <Link href={`/billing/${accountId}/setup`} className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-700">
            {account.status === "setup_pending" ? "Set up billing →" : "Edit setup"}
          </Link>
        </div>
      </header>

      <section className="max-w-xl">
        <div className={row}><span className={key}>Company (HubSpot)</span><span>{account.hubspot_company_id ?? "—"}</span></div>
        <div className={row}><span className={key}>Onboarding case</span><span>{account.onboarding_case_id ? <Link className="text-blue-600 hover:underline" href={`/onboarding/${account.onboarding_case_id}/review`}>view</Link> : "—"}</span></div>
        <div className={row}><span className={key}>Finance contact</span><span>{account.finance_contact_id ?? "—"}</span></div>
        <div className={row}><span className={key}>Contract start</span><span>{account.contract_start_date ? fmtDate(account.contract_start_date) : "—"}</span></div>
        <div className={row}><span className={key}>Notice period</span><span>{account.notice_period_days != null ? `${account.notice_period_days} days` : "—"}</span></div>
        <div className={row}><span className={key}>PO number</span><span>{account.po_number ?? "—"}</span></div>
        <div className={row}><span className={key}>Xero contact</span><span>{account.xero_contact_id ?? "— (Phase 4)"}</span></div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Items ({items.length})</h2>
        {items.length === 0 ? (
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">No items configured — use <strong>Set up billing</strong>.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => {
              const metric = (pricing.get(it.item_type)?.metric ?? "flat_monthly") as Metric;
              const hasOverride = it.override != null;
              return (
                <div key={it.id} className="rounded border border-neutral-200 p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{labelFor(it.item_type)} <span className="font-mono text-xs text-neutral-400">{metric}</span></span>
                    <span className="text-xs text-neutral-400">VAT {it.vat_treatment ?? "—"} {it.usage_api_key_hash ? "· key issued" : ""}</span>
                  </div>
                  <div className="mt-0.5 text-neutral-600">{describeConfig(metric, it.config as ItemConfig)}</div>
                  {hasOverride && (
                    <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      Override: <code>{JSON.stringify(it.override)}</code>{it.override_reason ? ` — ${it.override_reason}` : ""}
                    </div>
                  )}
                  {superAdmin && (
                    <form action={setItemOverrideAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-2">
                      <input type="hidden" name="item_id" value={it.id} />
                      <input type="hidden" name="account_id" value={accountId} />
                      <label className="text-xs text-neutral-500">Override JSON
                        <input name="override" defaultValue={it.override ? JSON.stringify(it.override) : ""} placeholder='{"amount_pence":9000}' className="mt-0.5 w-56 rounded border border-neutral-300 px-2 py-1 font-mono text-xs" />
                      </label>
                      <label className="text-xs text-neutral-500">Reason (required)
                        <input name="reason" defaultValue={it.override_reason ?? ""} className="mt-0.5 w-56 rounded border border-neutral-300 px-2 py-1 text-xs" />
                      </label>
                      <button type="submit" className="rounded border border-amber-400 px-2 py-1 text-xs text-amber-800 hover:bg-amber-50">Save override</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">HubSpot line items (mirror, read-only)</h2>
        {!lineItems?.length ? (
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">None mirrored — the deal has no line items, or the token lacks line-item read scope.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="py-1.5">Name</th><th>SKU</th><th>Qty</th><th>Price</th><th>Amount</th><th>Term</th></tr></thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id} className="border-b border-neutral-100"><td className="py-1.5">{li.name ?? "—"}</td><td>{li.sku ?? "—"}</td><td>{li.quantity ?? "—"}</td><td>{li.price ?? "—"}</td><td>{li.amount ?? "—"}</td><td>{li.term ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
