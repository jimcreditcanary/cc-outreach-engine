// Billing setup wizard (Phase 2). Offers only the item types the case was
// onboarded for, captures per-item pricing config + contract terms, shows the
// first-invoice preview, then activates (generating per-item usage keys).

import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { isSuperAdmin } from "@/lib/auth/role";
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

// Prices are catalogue-controlled: only a super-admin can edit them here. Deal
// owners see them read-only and can still set non-price controls (included,
// setup-fee trigger). The save action enforces this server-side too (S2).
function Price({ canEdit, name, label, value, placeholder, width }: {
  canEdit: boolean; name: string; label: string; value: string | number; placeholder?: string; width: string;
}) {
  return (
    <label className={lbl}>{label}
      {canEdit
        ? <input name={name} defaultValue={value} placeholder={placeholder} className={`${field} mt-0.5 ${width}`} />
        : <span className={`mt-0.5 block ${width} rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm text-neutral-600`}>{value === "" || value == null ? "—" : value}</span>}
    </label>
  );
}

function ItemConfigFields({ k, metric, cfg, canEditPrices }: { k: string; metric: Metric; cfg: ItemConfig; canEditPrices: boolean }) {
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
      {f.monthly && <Price canEdit={canEditPrices} name={p("amount")} label="£/month" value={gbp(num(cfg.amount_pence))} placeholder="0.00" width="w-24" />}
      {f.perUnit && <Price canEdit={canEditPrices} name={p("amount_pence")} label="pence/unit" value={num(cfg.amount_pence) ?? ""} placeholder="e.g. 50" width="w-24" />}
      {f.fixed && <Price canEdit={canEditPrices} name={p("fixed_pence")} label="pence/txn" value={num(cfg.fixed_pence) ?? ""} placeholder="e.g. 20" width="w-24" />}
      {f.pct && <Price canEdit={canEditPrices} name={p("pct")} label="% of value" value={cfg.pct ?? ""} placeholder="e.g. 1.5" width="w-20" />}
      {f.cap && <Price canEdit={canEditPrices} name={p("cap_pence")} label="cap pence" value={num(cfg.cap_pence ?? undefined) ?? ""} placeholder="optional" width="w-24" />}
      {f.perApplication && <Price canEdit={canEditPrices} name={p("per_application_pence")} label="pence/application" value={num(cfg.per_application_pence) ?? ""} placeholder="e.g. 500" width="w-28" />}
      {f.perNumberMonth && <Price canEdit={canEditPrices} name={p("per_number_month_pence")} label="pence/number/mo" value={num(cfg.per_number_month_pence) ?? ""} placeholder="e.g. 100" width="w-28" />}
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
  // Only super-admins may set unit prices; deal owners select items + terms (S2).
  const canEditPrices = await isSuperAdmin();
  const billingType = (account as { billing_type?: string }).billing_type ?? "auto"; // X1 (migration 073)

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
  const preview = account.contract_start_date ? previewFirstInvoice(previewItems, account.contract_start_date, { contractSigned: !!account.contract_signed_at }) : null;

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
            <label className={lbl}>Term (months)<input name="term_months" type="number" min="0" defaultValue={account.term_months ?? ""} placeholder="e.g. 24" className={`${field} mt-0.5 w-24`} /></label>
            <label className={lbl}>Notice (months)<input name="notice_months" type="number" min="0" defaultValue={account.notice_months ?? ""} placeholder="e.g. 3" className={`${field} mt-0.5 w-24`} /></label>
            <label className={lbl}>Break (months, optional)<input name="break_months" type="number" min="0" defaultValue={account.break_months ?? ""} placeholder="e.g. 12" className={`${field} mt-0.5 w-28`} /></label>
            <label className="flex items-center gap-1.5 self-end pb-1 text-xs text-neutral-600"><input type="checkbox" name="auto_renew" defaultChecked={account.auto_renew ?? true} /> auto-renew</label>
            <label className={lbl}>Finance contact (HubSpot id)<input name="finance_contact_id" defaultValue={financePrefill} placeholder="prefilled from onboarding" className={`${field} mt-0.5 w-56`} /></label>
            <label className={lbl}>PO number (optional)<input name="po_number" defaultValue={account.po_number ?? ""} className={`${field} mt-0.5 w-40`} /></label>
            <label className={lbl}>Invoice mode<select name="billing_type" defaultValue={billingType} className={`${field} mt-0.5`}>
              <option value="auto">Auto — authorise &amp; send</option>
              <option value="draft">Draft — manual review in Xero</option>
            </select></label>
          </div>
          {(account.term_end_date || account.renewal_decision_date) && (
            <p className="mt-2 text-xs text-neutral-500">
              {account.term_end_date && <>Term ends <strong>{account.term_end_date}</strong>. </>}
              {account.renewal_decision_date && <>Give notice by <strong>{account.renewal_decision_date}</strong> to avoid auto-renewal.</>}
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-500">
            Contract signed: {account.contract_signed_at
              ? <strong className="text-emerald-700">{account.contract_signed_at.slice(0, 10)}</strong>
              : <span className="text-amber-700">not yet — an “on contract signed” setup fee waits for this.</span>}
          </p>
        </section>

        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold">Items</h2>
          {!canEditPrices && <p className="mb-2 text-xs text-neutral-500">Prices are set from the catalogue (read-only). Select items and terms; a super-admin can adjust prices or set per-client overrides.</p>}
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
                  {/* Prefill from the account's saved config, else the catalogue standard price. */}
                  <ItemConfigFields k={e.key} metric={metric} cfg={(it?.config as ItemConfig) ?? (table?.config as ItemConfig) ?? {}} canEditPrices={canEditPrices} />
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
