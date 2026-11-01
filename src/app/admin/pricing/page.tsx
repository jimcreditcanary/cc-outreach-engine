// Super-admin pricing catalogue editor. Lists every pricing table (grouped by
// item type, newest version first), with an inline editor for the table's
// metric / VAT / placeholder flag and its graduated bands, plus "new version"
// so historic invoices stay reproducible. Prices are integer PENCE.

import { currentRole } from "@/lib/auth/role";
import { serviceClient } from "@/lib/db/client";
import { listPricingTables, listGroupMinimums, type PricingBand } from "@/lib/billing/repo";
import { labelFor, METRICS, VAT_TREATMENTS, type Metric } from "@/lib/billing/catalogue";
import { fieldsForMetric, type ItemConfig } from "@/lib/billing/itemConfig";
import { formatPence } from "@/lib/billing/money";
import { updatePricingTableAction, createPricingVersionAction, createProductAction, saveGroupMinimumAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "rounded border border-neutral-300 px-2 py-1 text-sm";
const today = () => new Date().toISOString().slice(0, 10);
const FREQUENCIES = ["", "monthly", "one_off"];

/** Per-metric standard-price inputs (write to the pricing table's config). */
function PriceFields({ metric, cfg }: { metric: Metric; cfg: ItemConfig }) {
  const f = fieldsForMetric(metric);
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  const gbp = (p?: number) => (p != null ? (p / 100).toFixed(2) : "");
  return (
    <div className="col-span-12 flex flex-wrap items-end gap-3 rounded bg-neutral-50 px-2 py-1.5">
      <span className="text-xs font-medium text-neutral-500">Standard price</span>
      {f.includable && <label className="flex items-center gap-1 text-xs text-neutral-600"><input type="checkbox" name="cfg_included" defaultChecked={cfg.included} /> included (£0)</label>}
      {f.monthly && <label className="text-xs text-neutral-500">£/month<input name="cfg_amount" defaultValue={gbp(n(cfg.amount_pence))} placeholder="0.00" className={`${field} mt-0.5 w-24`} /></label>}
      {f.perUnit && <label className="text-xs text-neutral-500">pence/unit<input name="cfg_amount_pence" defaultValue={n(cfg.amount_pence) ?? ""} placeholder="e.g. 50" className={`${field} mt-0.5 w-24`} /></label>}
      {f.fixed && <label className="text-xs text-neutral-500">pence/txn<input name="cfg_fixed_pence" defaultValue={n(cfg.fixed_pence) ?? ""} placeholder="e.g. 20" className={`${field} mt-0.5 w-24`} /></label>}
      {f.pct && <label className="text-xs text-neutral-500">% of value<input name="cfg_pct" defaultValue={cfg.pct ?? ""} placeholder="e.g. 1.5" className={`${field} mt-0.5 w-20`} /></label>}
      {f.cap && <label className="text-xs text-neutral-500">cap pence<input name="cfg_cap_pence" defaultValue={n(cfg.cap_pence ?? undefined) ?? ""} placeholder="optional" className={`${field} mt-0.5 w-24`} /></label>}
      {f.perApplication && <label className="text-xs text-neutral-500">pence/application<input name="cfg_per_application_pence" defaultValue={n(cfg.per_application_pence) ?? ""} placeholder="e.g. 500" className={`${field} mt-0.5 w-28`} /></label>}
      {f.perNumberMonth && <label className="text-xs text-neutral-500">pence/number/mo<input name="cfg_per_number_month_pence" defaultValue={n(cfg.per_number_month_pence) ?? ""} placeholder="e.g. 100" className={`${field} mt-0.5 w-28`} /></label>}
    </div>
  );
}

/** All price inputs, for the New-product form (metric isn't known at render;
 *  parseItemConfig keeps only the fields the chosen metric uses). */
function AllPriceFields() {
  return (
    <div className="col-span-12 flex flex-wrap items-end gap-3 rounded bg-neutral-50 px-2 py-1.5">
      <span className="text-xs font-medium text-neutral-500">Standard price <span className="font-normal text-neutral-400">(fill the fields your metric uses)</span></span>
      <label className="flex items-center gap-1 text-xs text-neutral-600"><input type="checkbox" name="cfg_included" /> included (£0)</label>
      <label className="text-xs text-neutral-500">£/month<input name="cfg_amount" placeholder="0.00" className={`${field} mt-0.5 w-24`} /></label>
      <label className="text-xs text-neutral-500">pence/unit<input name="cfg_amount_pence" placeholder="e.g. 50" className={`${field} mt-0.5 w-24`} /></label>
      <label className="text-xs text-neutral-500">pence/txn<input name="cfg_fixed_pence" placeholder="e.g. 10" className={`${field} mt-0.5 w-24`} /></label>
      <label className="text-xs text-neutral-500">% of value<input name="cfg_pct" placeholder="e.g. 0.5" className={`${field} mt-0.5 w-20`} /></label>
      <label className="text-xs text-neutral-500">cap pence<input name="cfg_cap_pence" placeholder="optional" className={`${field} mt-0.5 w-24`} /></label>
      <label className="text-xs text-neutral-500">pence/application<input name="cfg_per_application_pence" placeholder="e.g. 500" className={`${field} mt-0.5 w-28`} /></label>
      <label className="text-xs text-neutral-500">pence/number/mo<input name="cfg_per_number_month_pence" placeholder="e.g. 100" className={`${field} mt-0.5 w-28`} /></label>
    </div>
  );
}

function bandsToText(bands: PricingBand[]): string {
  return bands
    .map((b) => `${b.from_units} | ${b.to_units ?? "*"} | ${b.unit_price_pence} | ${b.minimum_type} | ${b.minimum_pence} | ${b.unit_cap_pence ?? ""}`)
    .join("\n");
}

const BANDS_HINT = "from | to(*=∞) | unit_price_pence | none|monthly|on_band_hit | minimum_pence | cap_pence(optional)";

export default async function PricingPage() {
  const role = await currentRole();
  if (role !== "super_admin") {
    return (
      <main className="px-4 py-6 md:px-8">
        <h1 className="text-xl font-semibold">Pricing catalogue</h1>
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This page is super-admin only. Ask an admin to set your role, or run:{" "}
          <code className="rounded bg-amber-100 px-1">update public.user_settings set role=&apos;super_admin&apos; where user_id=&apos;…&apos;;</code>
        </p>
      </main>
    );
  }

  const db = serviceClient();
  const [tables, groupMinimums] = await Promise.all([listPricingTables(db), listGroupMinimums(db)]);
  const { data: allBands } = await db
    .from("billing_pricing_bands")
    .select("id, pricing_table_id, from_units, to_units, unit_price_pence, minimum_type, minimum_pence, unit_cap_pence, sort_order")
    .in("pricing_table_id", tables.map((t) => t.id).length ? tables.map((t) => t.id) : ["00000000-0000-0000-0000-000000000000"])
    .order("sort_order", { ascending: true });
  const bandsByTable = new Map<string, PricingBand[]>();
  for (const b of (allBands ?? []) as PricingBand[]) {
    const arr = bandsByTable.get(b.pricing_table_id) ?? [];
    arr.push(b);
    bandsByTable.set(b.pricing_table_id, arr);
  }

  // Group tables by item_type (newest version first — listPricingTables order).
  const byItem = new Map<string, typeof tables>();
  for (const t of tables) {
    const arr = byItem.get(t.item_type) ?? [];
    arr.push(t);
    byItem.set(t.item_type, arr);
  }

  const placeholders = tables.filter((t) => t.is_placeholder).length;
  const knownGroups = [...new Set([...tables.map((t) => t.product_group).filter(Boolean) as string[], ...groupMinimums.map((g) => g.product_group)])].sort();

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Pricing catalogue</h1>
        <span className="text-sm text-neutral-500">{tables.length} tables · {byItem.size} item types</span>
      </header>

      {tables.length === 0 ? (
        <p className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          No pricing tables yet — run <code className="rounded bg-neutral-100 px-1">npm run billing-seed-pricing</code> after migration 058.
        </p>
      ) : (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {placeholders} of {tables.length} are <strong>PLACEHOLDER</strong> prices — seed real figures + confirm VAT with finance before go-live.
          Prices are entered in <strong>pence</strong>.
        </p>
      )}

      <datalist id="known-groups">{knownGroups.map((g) => <option key={g} value={g} />)}</datalist>

      {/* ── Add a new product ─────────────────────────────────────────────── */}
      <details className="mb-4 rounded-lg border border-neutral-200">
        <summary className="cursor-pointer rounded-t-lg bg-neutral-50 px-3 py-2 text-sm font-semibold">+ New product</summary>
        <form action={createProductAction} className="grid grid-cols-12 gap-2 p-3">
          <label className="col-span-3 text-xs text-neutral-500">Key (item_type)
            <input name="item_type" required placeholder="tu_new_product" className={`${field} mt-0.5 w-full font-mono`} />
          </label>
          <label className="col-span-4 text-xs text-neutral-500">Name
            <input name="name" placeholder="TU New Product" className={`${field} mt-0.5 w-full`} />
          </label>
          <label className="col-span-3 text-xs text-neutral-500">Product group
            <input name="product_group" list="known-groups" placeholder="tu_credit" className={`${field} mt-0.5 w-full`} />
          </label>
          <label className="col-span-2 text-xs text-neutral-500">VAT
            <select name="vat_treatment" className={`${field} mt-0.5 w-full`}>{VAT_TREATMENTS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
          </label>
          <label className="col-span-3 text-xs text-neutral-500">Metric
            <select name="metric" defaultValue="per_request" className={`${field} mt-0.5 w-full`}>{METRICS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </label>
          <label className="col-span-2 text-xs text-neutral-500">Type
            <select name="product_type" className={`${field} mt-0.5 w-full`}><option value="variable">variable</option><option value="fixed">fixed</option></select>
          </label>
          <label className="col-span-2 text-xs text-neutral-500">Band mode
            <select name="band_mode" className={`${field} mt-0.5 w-full`}><option value="volume">volume</option><option value="graduated">graduated</option></select>
          </label>
          <label className="col-span-2 text-xs text-neutral-500">Frequency
            <select name="billing_frequency" className={`${field} mt-0.5 w-full`}>{FREQUENCIES.map((fr) => <option key={fr} value={fr}>{fr || "— (usage)"}</option>)}</select>
          </label>
          <AllPriceFields />
          <label className="col-span-12 text-xs text-neutral-500">Variants / bands <span className="text-neutral-400">(optional; one per line — <code>{BANDS_HINT}</code>)</span>
            <textarea name="bands" rows={2} placeholder={BANDS_HINT} className={`${field} mt-0.5 w-full font-mono`} />
          </label>
          <label className="col-span-8 text-xs text-neutral-500">Internal notes
            <input name="internal_notes" className={`${field} mt-0.5 w-full`} />
          </label>
          <label className="col-span-2 flex items-center gap-1.5 self-end text-xs text-neutral-600"><input type="checkbox" name="is_placeholder" /> Placeholder</label>
          <div className="col-span-2 flex items-end justify-end"><button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700">Create</button></div>
        </form>
      </details>

      {/* ── Category (product-group) minimums ─────────────────────────────── */}
      <details className="mb-6 rounded-lg border border-neutral-200">
        <summary className="cursor-pointer rounded-t-lg bg-neutral-50 px-3 py-2 text-sm font-semibold">
          Category minimums <span className="font-normal text-neutral-500">— a monthly floor across all of a group&apos;s products (e.g. all TU ≥ £X/mo)</span>
        </summary>
        <div className="space-y-2 p-3">
          {groupMinimums.map((g) => (
            <form key={g.id} action={saveGroupMinimumAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="product_group" value={g.product_group} />
              <span className="min-w-40 font-mono text-xs text-neutral-600">{g.product_group}</span>
              <label className="text-xs text-neutral-500">£/month<input name="minimum" defaultValue={(g.minimum_pence / 100).toFixed(2)} className={`${field} mt-0.5 w-24`} /></label>
              <label className="flex-1 text-xs text-neutral-500">note<input name="note" defaultValue={g.note ?? ""} className={`${field} mt-0.5 w-full`} /></label>
              <button type="submit" className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50">Save</button>
              <span className="text-xs text-neutral-400">{g.minimum_pence > 0 ? `floor ${formatPence(g.minimum_pence)}` : "no floor"}</span>
            </form>
          ))}
          <form action={saveGroupMinimumAction} className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-2">
            <label className="text-xs text-neutral-500">group<input name="product_group" list="known-groups" placeholder="tu_credit" className={`${field} mt-0.5 w-40`} /></label>
            <label className="text-xs text-neutral-500">£/month<input name="minimum" placeholder="0.00" className={`${field} mt-0.5 w-24`} /></label>
            <label className="flex-1 text-xs text-neutral-500">note<input name="note" className={`${field} mt-0.5 w-full`} /></label>
            <button type="submit" className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50">+ Add</button>
          </form>
        </div>
      </details>

      <div className="space-y-6">
        {[...byItem.entries()].map(([itemType, versions]) => (
          <section key={itemType} className="rounded-lg border border-neutral-200">
            <div className="flex items-baseline justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2">
              <h2 className="text-sm font-semibold">{labelFor(itemType)} <span className="font-mono text-xs text-neutral-400">{itemType}</span></h2>
              <span className="text-xs text-neutral-500">{versions.length} version{versions.length === 1 ? "" : "s"}</span>
            </div>
            {versions.map((t, idx) => {
              const bands = bandsByTable.get(t.id) ?? [];
              const current = idx === 0; // newest first
              return (
                <div key={t.id} className={`px-3 py-3 ${idx > 0 ? "border-t border-neutral-100 opacity-70" : ""}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">v{t.version}</span>
                    <span>effective {t.effective_from}{t.effective_to ? ` → ${t.effective_to}` : ""}</span>
                    {t.is_placeholder && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">PLACEHOLDER</span>}
                    {current && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">current</span>}
                  </div>
                  <form action={updatePricingTableAction} className="grid grid-cols-12 gap-2">
                    <input type="hidden" name="table_id" value={t.id} />
                    <label className="col-span-4 text-xs text-neutral-500">Name
                      <input name="name" defaultValue={t.name} className={`${field} mt-0.5 w-full`} />
                    </label>
                    <label className="col-span-3 text-xs text-neutral-500">Product group
                      <input name="product_group" defaultValue={t.product_group ?? ""} className={`${field} mt-0.5 w-full`} />
                    </label>
                    <label className="col-span-3 text-xs text-neutral-500">Metric
                      <select name="metric" defaultValue={t.metric} className={`${field} mt-0.5 w-full`}>
                        {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                    <label className="col-span-2 text-xs text-neutral-500">VAT
                      <select name="vat_treatment" defaultValue={t.vat_treatment} className={`${field} mt-0.5 w-full`}>
                        {VAT_TREATMENTS.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                    <label className="col-span-2 text-xs text-neutral-500">Type
                      <select name="product_type" defaultValue={t.product_type} className={`${field} mt-0.5 w-full`}><option value="variable">variable</option><option value="fixed">fixed</option></select>
                    </label>
                    <label className="col-span-2 text-xs text-neutral-500">Band mode
                      <select name="band_mode" defaultValue={t.band_mode} className={`${field} mt-0.5 w-full`}><option value="volume">volume</option><option value="graduated">graduated</option></select>
                    </label>
                    <label className="col-span-2 text-xs text-neutral-500">Frequency
                      <select name="billing_frequency" defaultValue={t.billing_frequency ?? ""} className={`${field} mt-0.5 w-full`}>{FREQUENCIES.map((fr) => <option key={fr} value={fr}>{fr || "— (usage)"}</option>)}</select>
                    </label>
                    <label className="col-span-2 flex items-center gap-1.5 self-end text-xs text-neutral-600"><input type="checkbox" name="active" defaultChecked={t.active} /> Active</label>
                    <label className="col-span-4 text-xs text-neutral-500">Internal notes
                      <input name="internal_notes" defaultValue={t.internal_notes ?? ""} className={`${field} mt-0.5 w-full`} />
                    </label>
                    <PriceFields metric={t.metric} cfg={(t.config as ItemConfig) ?? {}} />
                    <label className="col-span-12 text-xs text-neutral-500">
                      Variants / bands <span className="text-neutral-400">(volume tiers; if set, they drive the price — the flat price above is the fallback)</span>: <code className="text-neutral-400">{BANDS_HINT}</code>
                      <textarea name="bands" rows={Math.max(2, bands.length + 1)} defaultValue={bandsToText(bands)}
                        className={`${field} mt-0.5 w-full font-mono`} />
                    </label>
                    <label className="col-span-4 flex items-center gap-1.5 text-xs text-neutral-600">
                      <input type="checkbox" name="is_placeholder" defaultChecked={t.is_placeholder} /> Placeholder price
                    </label>
                    <div className="col-span-8 flex justify-end">
                      <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700">Save</button>
                    </div>
                  </form>
                  {current && (
                    <form action={createPricingVersionAction} className="mt-2 flex items-center justify-end gap-2 border-t border-neutral-100 pt-2">
                      <input type="hidden" name="table_id" value={t.id} />
                      <span className="text-xs text-neutral-500">New version effective</span>
                      <input type="date" name="effective_from" defaultValue={today()} className={field} />
                      <button type="submit" className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50">+ Version</button>
                    </form>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </main>
  );
}
