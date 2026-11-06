// Billing account detail (Phase 2). Account fields, configured items with their
// pricing config, a super-admin override panel, and the mirrored HubSpot line
// items.

import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getBillingAccountById, listBillingItems, listBands, currentPricingByItemType } from "@/lib/billing/repo";
import { labelFor, type Metric } from "@/lib/billing/catalogue";
import { describeConfig, fieldsForMetric, type ItemConfig } from "@/lib/billing/itemConfig";
import { reconcile, comparablePricePence, type ConfiguredItem, type DealLine, type ReconStatus } from "@/lib/billing/reconcile";
import { dryRunAccountInvoice } from "@/lib/billing/invoiceRun";
import { formatPence } from "@/lib/billing/money";
import { isSuperAdmin } from "@/lib/auth/role";
import { setItemOverrideTypedAction, refreshLineItemsAction } from "../actions";
import { markContractSignedAction, resyncItemPricingAction } from "./setup/actions";
import { fmtDate } from "@/lib/format/datetime";

// Typed super-admin override inputs (U5), metric-aware, prefilled from the
// current override. Blank fields leave that key unset; all blank clears it.
function OverrideFields({ metric, ovr }: { metric: Metric; ovr: ItemConfig }) {
  const f = fieldsForMetric(metric);
  const gbp = (p?: number) => (p != null ? (p / 100).toFixed(2) : "");
  const num = (v: unknown) => (typeof v === "number" ? v : "");
  const fld = "mt-0.5 block rounded border border-neutral-300 px-2 py-1 text-xs";
  const lbl = "text-xs text-neutral-500";
  return (
    <>
      {f.includable && <label className="flex items-center gap-1 self-end pb-1 text-xs text-neutral-600"><input type="checkbox" name="ovr_included" defaultChecked={ovr.included} /> included (£0)</label>}
      {f.monthly && <label className={lbl}>£/mo<input name="ovr_amount" defaultValue={gbp(ovr.amount_pence)} placeholder="0.00" className={`${fld} w-24`} /></label>}
      {f.perUnit && <label className={lbl}>pence/unit<input name="ovr_amount_pence" defaultValue={num(ovr.amount_pence)} className={`${fld} w-24`} /></label>}
      {f.fixed && <label className={lbl}>pence/txn<input name="ovr_fixed_pence" defaultValue={num(ovr.fixed_pence)} className={`${fld} w-24`} /></label>}
      {f.pct && <label className={lbl}>% of value<input name="ovr_pct" defaultValue={ovr.pct ?? ""} className={`${fld} w-20`} /></label>}
      {f.cap && <label className={lbl}>cap pence<input name="ovr_cap_pence" defaultValue={num(ovr.cap_pence ?? undefined)} className={`${fld} w-24`} /></label>}
      {f.perApplication && <label className={lbl}>pence/application<input name="ovr_per_application_pence" defaultValue={num(ovr.per_application_pence)} className={`${fld} w-28`} /></label>}
      {f.perNumberMonth && <label className={lbl}>pence/number/mo<input name="ovr_per_number_month_pence" defaultValue={num(ovr.per_number_month_pence)} className={`${fld} w-28`} /></label>}
    </>
  );
}

const RECON_FLAG: Record<ReconStatus, { label: string; cls: string }> = {
  ok: { label: "✓ matches", cls: "bg-emerald-100 text-emerald-700" },
  price_mismatch: { label: "price differs", cls: "bg-amber-100 text-amber-800" },
  missing_setup: { label: "on deal, not set up", cls: "bg-amber-100 text-amber-800" },
  not_on_deal: { label: "set up, not on deal", cls: "bg-neutral-200 text-neutral-600" },
  unmapped: { label: "SKU not recognised", cls: "bg-red-100 text-red-700" },
};

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function BillingAccountPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ dry?: string }> }) {
  const { accountId } = await params;
  const { dry } = await searchParams;
  const db = serviceClient();
  const account = await getBillingAccountById(db, accountId);
  if (!account) notFound();

  // U2 — any-month dry-run (never persisted). Billed month = `dry` (YYYY-MM).
  const dryMonth = dry && MONTH_RE.test(dry) ? dry : null;
  const dryResult = dryMonth ? await dryRunAccountInvoice(db, accountId, `${dryMonth}-01`).catch(() => null) : null;

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

  // Reconcile what we set up vs what the deal sold (SKU → product key, + price).
  const configuredForRecon: ConfiguredItem[] = await Promise.all(items.filter((i) => i.active).map(async (it) => {
    const t = pricing.get(it.item_type);
    const bands = t ? await listBands(db, t.id) : [];
    const mergedCfg = { ...((t?.config ?? {}) as object), ...(it.config as object) } as { amount_pence?: number; fixed_pence?: number };
    return { item_type: it.item_type, label: t?.name ?? it.item_type, our_price_pence: t ? comparablePricePence(t.metric, mergedCfg, bands) : null };
  }));
  const dealLines: DealLine[] = (lineItems ?? []).map((li) => ({ sku: li.sku, name: li.name, quantity: li.quantity, price: li.price }));
  const recon = reconcile(dealLines, configuredForRecon, { knownKeys: new Set(pricing.keys()) });

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
        <div className={row}><span className={key}>Term</span><span>{account.term_months != null ? `${account.term_months} months${account.auto_renew === false ? "" : " · auto-renew"}` : "—"}</span></div>
        <div className={row}><span className={key}>Term ends</span><span>{account.term_end_date ? fmtDate(account.term_end_date) : "—"}</span></div>
        <div className={row}><span className={key}>Notice by (no auto-renew)</span><span>{account.renewal_decision_date ? fmtDate(account.renewal_decision_date) : (account.notice_period_days != null ? `${account.notice_period_days} days before end` : "—")}</span></div>
        <div className={row}>
          <span className={key}>Contract signed</span>
          <span className="flex items-center gap-2">
            {account.contract_signed_at ? <span className="text-emerald-700">{fmtDate(account.contract_signed_at)}</span> : <span className="text-amber-700">not signed</span>}
            {!account.contract_signed_at && (
              <form action={markContractSignedAction}>
                <input type="hidden" name="account_id" value={accountId} />
                <button type="submit" className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">Mark signed</button>
              </form>
            )}
          </span>
        </div>
        <div className={row}><span className={key}>PO number</span><span>{account.po_number ?? "—"}</span></div>
        <div className={row}><span className={key}>Xero contact</span><span>{account.xero_contact_id ?? "— (created at activation)"}</span></div>
      </section>

      <section className="mt-6 max-w-xl rounded-lg border border-neutral-200 p-3">
        <h2 className="mb-2 text-sm font-semibold">Preview any month <span className="font-normal text-neutral-400">(dry-run — nothing is saved)</span></h2>
        <form method="get" className="flex items-end gap-2">
          <label className="text-xs text-neutral-500">Billed month
            <input type="month" name="dry" defaultValue={dryMonth ?? ""} className="mt-0.5 block rounded border border-neutral-300 px-2 py-1 text-sm" />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">Compute</button>
          {dryMonth && <Link href={`/billing/${accountId}`} className="text-xs text-neutral-500 hover:underline">clear</Link>}
        </form>
        {dryMonth && (
          dryResult && dryResult.lines.length ? (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="py-1">Description</th><th className="text-right">Qty</th><th className="text-right">Net</th><th className="text-right">VAT</th></tr></thead>
              <tbody>
                {dryResult.lines.map((l, i) => (
                  <tr key={i} className="border-t border-neutral-100"><td className="py-1">{l.description}</td><td className="text-right">{l.quantity}</td><td className="text-right">{formatPence(l.line_amount_pence)}</td><td className="text-right">{formatPence(l.vat_pence)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-neutral-300 font-semibold"><td className="py-1 text-right" colSpan={2}>Total (inc. VAT)</td><td className="text-right" colSpan={2}>{formatPence(dryResult.total_pence)}</td></tr></tfoot>
            </table>
          ) : (
            <p className="mt-3 text-sm text-neutral-500">No billable lines for {dryMonth} — the account may start later, be cancelled, or have only usage not yet reported for that month.</p>
          )
        )}
        <p className="mt-2 text-xs text-neutral-400">Usage lines reflect usage already recorded for that month; months with no reported usage show recurring/minimum lines only.</p>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Items ({items.length})</h2>
          {superAdmin && items.length > 0 && (
            <form action={resyncItemPricingAction}>
              <input type="hidden" name="account_id" value={accountId} />
              <button type="submit" className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50" title="Re-freeze each item's pricing from the current catalogue. Future invoices only.">Re-sync pricing from catalogue</button>
            </form>
          )}
        </div>
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
                    <span className="text-xs text-neutral-400">VAT {it.vat_treatment ?? "—"} {it.usage_api_key_hash ? "· key issued" : ""} {it.priced_at ? `· priced ${fmtDate(it.priced_at)}` : ""}</span>
                  </div>
                  <div className="mt-0.5 text-neutral-600">{describeConfig(metric, it.config as ItemConfig)}</div>
                  {hasOverride && (
                    <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      Override: <code>{JSON.stringify(it.override)}</code>{it.override_reason ? ` — ${it.override_reason}` : ""}
                    </div>
                  )}
                  {superAdmin && (
                    <form action={setItemOverrideTypedAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-2">
                      <input type="hidden" name="item_id" value={it.id} />
                      <input type="hidden" name="account_id" value={accountId} />
                      <OverrideFields metric={metric} ovr={(it.override as ItemConfig) ?? {}} />
                      <label className="text-xs text-neutral-500">Reason (required)
                        <input name="reason" defaultValue={it.override_reason ?? ""} className="mt-0.5 block w-48 rounded border border-neutral-300 px-2 py-1 text-xs" />
                      </label>
                      <button type="submit" className="rounded border border-amber-400 px-2 py-1 text-xs text-amber-800 hover:bg-amber-50">Save override</button>
                      <span className="w-full text-[11px] text-neutral-400">Overrides this client only; blank fields unset that price, all blank clears it.</span>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold">Were we accurate?</h2>
          {dealLines.length === 0 ? null : recon.accurate
            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">✓ setup matches the deal</span>
            : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">⚠ {recon.issues} to check</span>}
        </div>
        {dealLines.length === 0 ? (
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">No deal line items mirrored to compare against.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="py-1.5">Product</th><th>On deal</th><th>Set up</th><th>Deal price</th><th>Our price</th><th>Flag</th></tr></thead>
            <tbody>
              {recon.rows.map((r, i) => (
                <tr key={`${r.item_type ?? "x"}-${i}`} className="border-b border-neutral-100">
                  <td className="py-1.5">{r.label} {r.item_type ? <span className="font-mono text-xs text-neutral-400">{r.item_type}</span> : null}</td>
                  <td>{r.on_deal ? "✓" : "—"}</td>
                  <td>{r.configured ? "✓" : "—"}</td>
                  <td>{r.deal_price_pence != null ? formatPence(r.deal_price_pence) : "—"}</td>
                  <td>{r.our_price_pence != null ? formatPence(r.our_price_pence) : <span className="text-neutral-400">n/a</span>}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${RECON_FLAG[r.status].cls}`}>{RECON_FLAG[r.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">HubSpot line items (mirror, read-only)</h2>
          <form action={refreshLineItemsAction}>
            <input type="hidden" name="account_id" value={accountId} />
            <button type="submit" className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50" title="Re-pull the deal's line items from HubSpot (reporting only).">Refresh from HubSpot</button>
          </form>
        </div>
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
