// Billing v2 — seed the Product Library from productSeed.ts into
// billing_pricing_tables (+ _bands) and billing_group_minimums.
//
// Idempotent + re-runnable: upserts each product (keyed by item_type, version 1)
// with its real prices from the sheet, replaces its variant bands, seeds group
// minimums, and prunes stale v1 product keys that v2 renamed (only when nothing
// references them). Run AFTER migration 063:
//
//   npx tsx scripts/billing-seed-products.ts
//
// Uses the REST service client (NEXT_PUBLIC_SUPABASE_URL + SERVICE_ROLE_KEY),
// not the pooler — same path the app + Phase-1 seed use.

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";
import { PRODUCTS, GROUP_MINIMUMS, type SeedProduct, type SeedBand } from "../src/lib/billing/productSeed";

function bandsFor(p: SeedProduct): SeedBand[] {
  if (p.bands?.length) return p.bands;
  // Single flat band at unit_pence (or 0 for config-driven fixed/pct/flat lines).
  return [{ from: 0, to: null, unit_pence: p.unit_pence ?? 0 }];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Guard: never touch pricing while real billing items exist.
  const { count: itemCount, error: cErr } = await db.from("billing_items").select("*", { count: "exact", head: true });
  if (cErr) throw new Error(`billing_items count failed: ${cErr.message}`);
  if ((itemCount ?? 0) > 0) throw new Error(`refusing to reseed: ${itemCount} billing_items exist — pricing edits must go through /admin to preserve versions.`);

  let created = 0, updated = 0;
  const seededKeys = new Set<string>();

  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i]!;
    seededKeys.add(p.key);
    const row = {
      item_type: p.key,
      name: p.label,
      product_group: p.group,
      metric: p.metric,
      product_type: p.type,
      band_mode: p.band_mode ?? "volume",
      billing_frequency: p.frequency ?? null,
      delayed_start_months: 0,
      config: p.config ?? {},
      vat_treatment: p.vat,
      is_placeholder: false,
      active: true,
      sort_order: i,
      internal_notes: p.notes ?? null,
      version: 1,
    };

    const { data: existing, error: selErr } = await db.from("billing_pricing_tables").select("id").eq("item_type", p.key).limit(1);
    if (selErr) throw new Error(`${p.key} select: ${selErr.message}`);

    let tableId: string;
    if (existing && existing.length) {
      tableId = existing[0]!.id;
      const { error: upErr } = await db.from("billing_pricing_tables").update(row).eq("id", tableId);
      if (upErr) throw new Error(`${p.key} update: ${upErr.message}`);
      updated++;
    } else {
      const { data: ins, error: insErr } = await db.from("billing_pricing_tables").insert(row).select("id").single();
      if (insErr || !ins) throw new Error(`${p.key} insert: ${insErr?.message}`);
      tableId = ins.id;
      created++;
    }

    // Replace bands.
    const { error: delBErr } = await db.from("billing_pricing_bands").delete().eq("pricing_table_id", tableId);
    if (delBErr) throw new Error(`${p.key} band delete: ${delBErr.message}`);
    const bandRows = bandsFor(p).map((b, j) => ({
      pricing_table_id: tableId,
      from_units: b.from,
      to_units: b.to,
      unit_price_pence: b.unit_pence,
      minimum_type: (b.min_monthly_pence ?? 0) > 0 ? "monthly" : "none",
      minimum_pence: b.min_monthly_pence ?? 0,
      unit_cap_pence: b.cap_pence ?? null,
      sort_order: j,
    }));
    const { error: insBErr } = await db.from("billing_pricing_bands").insert(bandRows);
    if (insBErr) throw new Error(`${p.key} band insert: ${insBErr.message}`);
    console.log(`✓ ${p.key} (${bandRows.length} band${bandRows.length === 1 ? "" : "s"})`);
  }

  // Prune stale v1 keys that v2 renamed (safe — 0 items referencing them).
  const { data: allTables, error: allErr } = await db.from("billing_pricing_tables").select("id, item_type");
  if (allErr) throw new Error(`list tables: ${allErr.message}`);
  const stale = (allTables ?? []).filter((t) => !seededKeys.has(t.item_type));
  for (const s of stale) {
    const { error: dErr } = await db.from("billing_pricing_tables").delete().eq("id", s.id); // bands cascade
    if (dErr) throw new Error(`prune ${s.item_type}: ${dErr.message}`);
    console.log(`– pruned stale ${s.item_type}`);
  }

  // Group minimums (insert-if-absent so a manually-set value isn't clobbered).
  for (const g of GROUP_MINIMUMS) {
    const { data: ex, error: gSel } = await db.from("billing_group_minimums").select("id").eq("product_group", g.product_group).limit(1);
    if (gSel) throw new Error(`group min select ${g.product_group}: ${gSel.message}`);
    if (ex && ex.length) { console.log(`• group minimum ${g.product_group} exists, left as-is`); continue; }
    const { error: gIns } = await db.from("billing_group_minimums").insert({ product_group: g.product_group, minimum_pence: g.minimum_pence, note: g.note });
    if (gIns) throw new Error(`group min insert ${g.product_group}: ${gIns.message}`);
    console.log(`✓ group minimum ${g.product_group} (${g.minimum_pence}p)`);
  }

  console.log(`\nDone. ${created} created, ${updated} updated, ${stale.length} pruned, ${PRODUCTS.length} products total.`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
