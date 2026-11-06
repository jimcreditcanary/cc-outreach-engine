// Billing v2 — additively insert the Phase-5 catalogue rows (C1/C2) that the
// full seed can't add because it refuses to run while billing_items exist.
// Inserts ONLY the keys below, and ONLY if absent — it never touches existing
// products, bands, versions or items. Idempotent + safe on the live DB:
//
//   npx tsx scripts/billing-add-products.ts
//
// Uses the REST service client (NEXT_PUBLIC_SUPABASE_URL + SERVICE_ROLE_KEY).

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";
import { PRODUCTS, type SeedProduct, type SeedBand } from "../src/lib/billing/productSeed";

// The only keys this script is allowed to add (Phase 5 C1 + C2).
const NEW_KEYS = new Set(["comms_sms_numbers", "comms_whatsapp_numbers", "open_banking_ais_fixed"]);

function bandsFor(p: SeedProduct): SeedBand[] {
  if (p.bands?.length) return p.bands;
  return [{ from: 0, to: null, unit_pence: p.unit_pence ?? 0 }];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const toAdd = PRODUCTS.filter((p) => NEW_KEYS.has(p.key));
  if (toAdd.length !== NEW_KEYS.size) throw new Error(`productSeed is missing one of: ${[...NEW_KEYS].join(", ")}`);

  let added = 0;
  for (const p of toAdd) {
    const { data: existing, error: selErr } = await db.from("billing_pricing_tables").select("id").eq("item_type", p.key).limit(1);
    if (selErr) throw new Error(`${p.key} select: ${selErr.message}`);
    if (existing && existing.length) { console.log(`• ${p.key} already present — left as-is`); continue; }

    const sortOrder = PRODUCTS.findIndex((x) => x.key === p.key);
    const { data: ins, error: insErr } = await db.from("billing_pricing_tables").insert({
      item_type: p.key, name: p.label, product_group: p.group, metric: p.metric,
      product_type: p.type, band_mode: p.band_mode ?? "volume", billing_frequency: p.frequency ?? null,
      delayed_start_months: 0, config: p.config ?? {}, vat_treatment: p.vat,
      is_placeholder: false, active: true, sort_order: sortOrder, internal_notes: p.notes ?? null, version: 1,
    }).select("id").single();
    if (insErr || !ins) throw new Error(`${p.key} insert: ${insErr?.message}`);

    const bandRows = bandsFor(p).map((b, j) => ({
      pricing_table_id: ins.id, from_units: b.from, to_units: b.to, unit_price_pence: b.unit_pence,
      minimum_type: (b.min_monthly_pence ?? 0) > 0 ? "monthly" : "none", minimum_pence: b.min_monthly_pence ?? 0,
      unit_cap_pence: b.cap_pence ?? null, sort_order: j,
    }));
    const { error: insBErr } = await db.from("billing_pricing_bands").insert(bandRows);
    if (insBErr) throw new Error(`${p.key} band insert: ${insBErr.message}`);
    console.log(`✓ added ${p.key} (${bandRows.length} band${bandRows.length === 1 ? "" : "s"})`);
    added++;
  }
  console.log(`\nDone. ${added} added, ${toAdd.length - added} already present.`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
