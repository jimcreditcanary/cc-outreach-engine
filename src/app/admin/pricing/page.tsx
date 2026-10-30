// Super-admin pricing catalogue editor. Lists every pricing table (grouped by
// item type, newest version first), with an inline editor for the table's
// metric / VAT / placeholder flag and its graduated bands, plus "new version"
// so historic invoices stay reproducible. Prices are integer PENCE.

import { currentRole } from "@/lib/auth/role";
import { serviceClient } from "@/lib/db/client";
import { listPricingTables, type PricingBand } from "@/lib/billing/repo";
import { labelFor, METRICS, VAT_TREATMENTS } from "@/lib/billing/catalogue";
import { updatePricingTableAction, createPricingVersionAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "rounded border border-neutral-300 px-2 py-1 text-sm";
const today = () => new Date().toISOString().slice(0, 10);

function bandsToText(bands: PricingBand[]): string {
  return bands
    .map((b) => `${b.from_units} | ${b.to_units ?? "*"} | ${b.unit_price_pence} | ${b.minimum_type} | ${b.minimum_pence}`)
    .join("\n");
}

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
  const tables = await listPricingTables(db);
  const { data: allBands } = await db
    .from("billing_pricing_bands")
    .select("id, pricing_table_id, from_units, to_units, unit_price_pence, minimum_type, minimum_pence, sort_order")
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
                    <label className="col-span-12 text-xs text-neutral-500">
                      Bands — one per line: <code className="text-neutral-400">from | to(*=∞) | unit_price_pence | none|monthly|on_band_hit | minimum_pence</code>
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
