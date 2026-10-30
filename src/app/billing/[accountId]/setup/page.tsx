// Billing setup wizard (Phase 2). Offers only the item types the case was
// onboarded for, captures per-item pricing config + contract terms, shows the
// first-invoice preview, then activates (generating per-item usage keys).

import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getBillingAccountById, listBillingItems, currentPricingByItemType } from "@/lib/billing/repo";
import { CATALOGUE, type Metric } from "@/lib/billing/catalogue";
import { fieldsForMetric, type ItemConfig } from "@/lib/billing/itemConfig";
import { previewFirstInvoice, type PreviewItem } from "@/lib/billing/preview";
import { formatPence } from "@/lib/billing/money";
import { saveBillingSetupAction, activateBillingAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "rounded border border-neutral-300 px-2 py-1 text-sm";
const lbl = "block text-xs text-neutral-500";

function num(v: unknown): number | undefined { return typeof v === "number" ? v : undefined; }

function ItemConfigFields({ k, metric, cfg }: { k: string; metric: Metric; cfg: ItemConfig }) {
  const f = fieldsForMetric(metric);
  const p = (field: string) => `cfg_${k}_${field}`;
  const gbp = (pence?: number) => (pence != null ? (pence / 100).toFixed(2) : "");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3">
      {f.includable && (
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input type="checkbox" name={p("included")} defaultChecked={cfg.included} /> included (£0)
        </label>
      )}
      {f.monthly && <label className={lbl}>£/month<input name={p("amount")} defaultValue={gbp(num(cfg.amount_pence))} placeholder="0.00" className={`${field} mt-0.5 w-24`} /></label>}
      {f.perUnit && <label className={lbl}>pence/unit<input name={p("amount_pence")} defaultValue={num(cfg.amount_pence) ?? ""} placeholder="e.g. 50" className={`${field} mt-0.5 w-24`} /></label>}
      {f.fixed && <label className={lbl}>pence/txn<input name={p("fixed_pence")} defaultValue={num(cfg.fixed_pence) ?? ""} placeholder="e.g. 20" className={`${field} mt-0.5 w-24`} /></label>}
      {f.pct && <label className={lbl}>% of value<input name={p("pct")} defaultValue={cfg.pct ?? ""} placeholder="e.g. 1.5" className={`${field} mt-0.5 w-20`} /></label>}
      {f.cap && <label className={lbl}>cap pence<input name={p("cap_pence")} defaultValue={num(cfg.cap_pence ?? undefined) ?? ""} placeholder="optional" className={`${field} mt-0.5 w-24`} /></label>}
      {f.perApplication && <label className={lbl}>pence/application<input name={p("per_application_pence")} defaultValue={num(cfg.per_application_pence) ?? ""} placeholder="e.g. 500" className={`${field} mt-0.5 w-28`} /></label>}
      {f.perNumberMonth && <label className={lbl}>pence/number/mo<input name={p("per_number_month_pence")} defaultValue={num(cfg.per_number_month_pence) ?? ""} placeholder="e.g. 100" className={`${field} mt-0.5 w-28`} /></label>}
      {metric === "flat_monthly" && k === "setup_fee" && (
        <label className={lbl}>billed<select name={p("billing_trigger")} defaultValue={cfg.billing_trigger ?? "on_contract_signed"} className={`${field} mt-0.5`}>
          <option value="on_contract_signed">on contract signed</option>
          <option value="on_go_live">on go-live</option>
        </select></label>
      )}
    </div>
  );
}

export default async function BillingSetupPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceClient();
  const account = await getBillingAccountById(db, accountId);
  if (!account) notFound();

  // Case → product groups (which items are offered) + finance stakeholder prefill.
  let productGroups: string[] = [];
  let financePrefill = account.finance_contact_id ?? "";
  if (account.onboarding_case_id) {
    const { data: c } = await db.from("onboarding_cases").select("product_groups").eq("id", account.onboarding_case_id).maybeSingle();
    productGroups = (c?.product_groups as string[] | undefined) ?? [];
    if (!financePrefill) {
      const { data: fin } = await db.from("onboarding_stakeholders").select("hubspot_contact_id").eq("case_id", account.onboarding_case_id).eq("role", "finance").maybeSingle();
      financePrefill = (fin?.hubspot_contact_id as string | undefined) ?? "";
    }
  }
  const hasSettlement = productGroups.includes("settlement_accounts");
  const offered = CATALOGUE.filter(
    (e) => e.productGroup === "core" || e.productGroup === "comms" || productGroups.includes(e.productGroup) || (e.key === "faster_payments" && hasSettlement),
  );

  const pricing = await currentPricingByItemType(db);
  const existing = await listBillingItems(db, accountId);
  const byType = new Map(existing.map((it) => [it.item_type, it]));

  // First-invoice preview from the saved items.
  const previewItems: PreviewItem[] = existing.map((it) => {
    const metric = (pricing.get(it.item_type)?.metric ?? "flat_monthly") as Metric;
    return { item_type: it.item_type, label: CATALOGUE.find((c) => c.key === it.item_type)?.label ?? it.item_type, metric, vat_treatment: (it.vat_treatment as PreviewItem["vat_treatment"]) ?? "standard", config: it.config as ItemConfig };
  });
  const preview = account.contract_start_date ? previewFirstInvoice(previewItems, account.contract_start_date) : null;

  if (account.status === "active") {
    return (
      <main className="px-4 py-6 md:px-8">
        <Link href={`/billing/${accountId}`} className="text-sm text-neutral-500 hover:underline">← Billing account</Link>
        <h1 className="mt-2 text-xl font-semibold">Billing setup</h1>
        <p className="mt-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">This account is already <strong>active</strong>. Edit items below if needed, or go back to the account.</p>
      </main>
    );
  }

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href={`/billing/${accountId}`} className="text-sm text-neutral-500 hover:underline">← Billing account</Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold">Set up billing</h1>
      <p className="mb-4 text-sm text-neutral-500">Offering items for product groups: {productGroups.length ? productGroups.join(", ") : "core only"}. Money fields are pence unless marked £.</p>

      <form action={saveBillingSetupAction}>
        <input type="hidden" name="account_id" value={accountId} />

        <section className="mb-5 rounded-lg border border-neutral-200 p-3">
          <h2 className="mb-2 text-sm font-semibold">Contract terms</h2>
          <div className="flex flex-wrap gap-4">
            <label className={lbl}>Contract start<input type="date" name="contract_start_date" defaultValue={account.contract_start_date ?? ""} className={`${field} mt-0.5`} /></label>
            <label className={lbl}>Notice period (days)<input name="notice_period_days" type="number" defaultValue={account.notice_period_days ?? ""} placeholder="e.g. 90" className={`${field} mt-0.5 w-28`} /></label>
            <label className={lbl}>Finance contact (HubSpot id)<input name="finance_contact_id" defaultValue={financePrefill} placeholder="prefilled from onboarding" className={`${field} mt-0.5 w-56`} /></label>
            <label className={lbl}>PO number (optional)<input name="po_number" defaultValue={account.po_number ?? ""} className={`${field} mt-0.5 w-40`} /></label>
          </div>
        </section>

        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold">Items</h2>
          <div className="space-y-2">
            {offered.map((e) => {
              const table = pricing.get(e.key);
              const metric = (table?.metric ?? e.metric) as Metric;
              const it = byType.get(e.key);
              const selected = !!it;
              return (
                <div key={e.key} className="rounded border border-neutral-200 p-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name={`item_${e.key}`} defaultChecked={selected} />
                      <span className="font-medium">{e.label}</span>
                      <span className="font-mono text-xs text-neutral-400">{metric}</span>
                      {!table && <span className="rounded bg-red-100 px-1 text-[10px] text-red-700">no pricing table</span>}
                    </label>
                    <span className="text-xs text-neutral-400">VAT {table?.vat_treatment ?? e.vat}</span>
                  </div>
                  <ItemConfigFields k={e.key} metric={metric} cfg={(it?.config as ItemConfig) ?? {}} />
                </div>
              );
            })}
          </div>
        </section>

        <button type="submit" className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white hover:bg-neutral-700">Save &amp; preview</button>
      </form>

      {preview && (
        <section className="mt-6 rounded-lg border border-neutral-200 p-3">
          <h2 className="mb-2 text-sm font-semibold">First-invoice preview <span className="font-normal text-neutral-400">(from {account.contract_start_date})</span></h2>
          {preview.lines.length === 0 ? (
            <p className="text-sm text-neutral-500">No fixed charges on the first invoice.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="py-1">Item</th><th>Description</th><th className="text-right">Net</th><th className="text-right">VAT</th><th className="text-right">Gross</th></tr></thead>
              <tbody>
                {preview.lines.map((l, i) => (
                  <tr key={i} className="border-t border-neutral-100"><td className="py-1">{l.label}</td><td className="text-neutral-500">{l.description}</td><td className="text-right">{formatPence(l.net_pence)}</td><td className="text-right">{formatPence(l.vat_pence)}</td><td className="text-right">{formatPence(l.gross_pence)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-neutral-300 font-semibold"><td colSpan={2} className="py-1 text-right">Total</td><td className="text-right">{formatPence(preview.subtotal_pence)}</td><td className="text-right">{formatPence(preview.vat_pence)}</td><td className="text-right">{formatPence(preview.total_pence)}</td></tr></tfoot>
            </table>
          )}
          {preview.notes.map((n, i) => <p key={i} className="mt-1 text-xs text-neutral-500">• {n}</p>)}
          <form action={activateBillingAction} className="mt-3 border-t border-neutral-100 pt-3">
            <input type="hidden" name="account_id" value={accountId} />
            <button type="submit" className="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-500">Confirm &amp; activate</button>
            <span className="ml-2 text-xs text-neutral-500">Generates per-item usage keys (shown once) and sets the account active.</span>
          </form>
        </section>
      )}
    </main>
  );
}
