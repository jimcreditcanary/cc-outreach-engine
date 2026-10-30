// Seed billing_pricing_tables with one PLACEHOLDER row per catalogue item type
// (+ a single zero-price placeholder band). Idempotent: an item type that
// already has a pricing table is skipped. Prices/bands are set later from
// /admin/pricing by a super-admin. Run after migration 058:
//
//   npx tsx scripts/billing-seed-pricing.ts

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";
import { CATALOGUE } from "../src/lib/billing/catalogue";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let created = 0;
  let skipped = 0;
  for (const item of CATALOGUE) {
    const { data: existing, error: selErr } = await db
      .from("billing_pricing_tables")
      .select("id")
      .eq("item_type", item.key)
      .limit(1);
    if (selErr) { console.error(`✗ ${item.key} — select failed: ${selErr.message}`); process.exitCode = 1; continue; }
    if (existing && existing.length) { console.log(`• ${item.key} — exists, skipped`); skipped += 1; continue; }

    const { data: table, error: insErr } = await db
      .from("billing_pricing_tables")
      .insert({
        item_type: item.key,
        name: item.label,
        product_group: item.productGroup,
        metric: item.metric,
        config: { included: false, PLACEHOLDER: true },
        vat_treatment: item.vat,
        is_placeholder: true,
        version: 1,
      })
      .select("id")
      .single();
    if (insErr || !table) { console.error(`✗ ${item.key} — insert failed: ${insErr?.message}`); process.exitCode = 1; continue; }

    const { error: bandErr } = await db.from("billing_pricing_bands").insert({
      pricing_table_id: table.id,
      from_units: 0,
      to_units: null,
      unit_price_pence: 0,
      minimum_type: "none",
      minimum_pence: 0,
      sort_order: 0,
    });
    if (bandErr) { console.error(`✗ ${item.key} — band insert failed: ${bandErr.message}`); process.exitCode = 1; continue; }
    console.log(`✓ ${item.key} — seeded (PLACEHOLDER)`);
    created += 1;
  }
  console.log(`\nDone. ${created} created, ${skipped} skipped, ${CATALOGUE.length} total item types.`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
