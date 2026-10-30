// Verify every object created by migrations 048–057 exists, using the SAME
// channel the app uses: the Supabase REST API with the service-role key
// (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Read-only.
//
//   npx tsx scripts/check-onboarding-migrations.ts
//
// (Deliberately NOT a direct Postgres connection — db.<ref>.supabase.co is
// IPv4-deprecated and often won't resolve; the app never uses it either.)
//
// Exits 0 if everything is present, 1 if anything is missing (and prints the
// migration file you still need to run in the Supabase SQL editor).

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Check =
  | { kind: "table"; table: string; migration: string }
  | { kind: "column"; table: string; column: string; migration: string }
  | { kind: "bucket"; id: string; migration: string };

// Enums (onboarding_case_status, onboarding_role) are created in 048 alongside
// the tables that use them, so onboarding_cases existing implies the enums do.
const CHECKS: Check[] = [
  { kind: "table", table: "onboarding_cases", migration: "048_onboarding_core.sql" },
  { kind: "table", table: "onboarding_stakeholders", migration: "048_onboarding_core.sql" },
  { kind: "table", table: "onboarding_events", migration: "048_onboarding_core.sql" },
  { kind: "table", table: "lead_call_invites", migration: "049_lead_call_invites.sql" },
  { kind: "table", table: "onboarding_company_snapshot", migration: "050_onboarding_ch_enrichment.sql" },
  { kind: "table", table: "onboarding_officers", migration: "050_onboarding_ch_enrichment.sql" },
  { kind: "table", table: "onboarding_ubos", migration: "050_onboarding_ch_enrichment.sql" },
  { kind: "table", table: "onboarding_merchant_form", migration: "051_onboarding_merchant_form.sql" },
  { kind: "table", table: "onboarding_ubo_kyc", migration: "051_onboarding_merchant_form.sql" },
  { kind: "table", table: "onboarding_bank_accounts", migration: "052_onboarding_payments.sql" },
  { kind: "table", table: "onboarding_direct_debit", migration: "052_onboarding_payments.sql" },
  { kind: "table", table: "onboarding_privacy_assessment", migration: "053_onboarding_privacy_assessment.sql" },
  { kind: "bucket", id: "onboarding-uploads", migration: "054_onboarding_uploads.sql" },
  { kind: "table", table: "onboarding_uploads", migration: "054_onboarding_uploads.sql" },
  { kind: "column", table: "onboarding_ubo_kyc", column: "date_of_birth", migration: "055_onboarding_ubo_checks.sql" },
  { kind: "table", table: "onboarding_ubo_checks", migration: "055_onboarding_ubo_checks.sql" },
  { kind: "table", table: "onboarding_generated_docs", migration: "056_onboarding_generated_docs.sql" },
  { kind: "table", table: "onboarding_accounts", migration: "057_onboarding_accounts.sql" },
];

// "Missing object" error codes from PostgREST / Postgres.
const MISSING = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

async function present(c: SupabaseClient, chk: Check): Promise<boolean> {
  if (chk.kind === "bucket") {
    const { data, error } = await c.storage.getBucket(chk.id);
    if (error) return false;
    return !!data;
  }
  // Use a real GET (not HEAD): a HEAD request does NOT surface PostgREST's
  // PGRST205 "table not in schema cache" as an error in supabase-js, so a
  // missing table would false-pass. A GET returns the error in the body.
  const col = chk.kind === "column" ? chk.column : "*";
  const { error } = await c.from(chk.table).select(col).limit(1);
  if (!error) return true;
  if (MISSING.has(error.code ?? "")) return false;
  // An unexpected error (network/permission) — surface it, treat as unknown.
  throw new Error(`${error.code ?? "?"}: ${error.message}`);
}

function label(chk: Check): string {
  if (chk.kind === "table") return `table  ${chk.table}`;
  if (chk.kind === "column") return `column ${chk.table}.${chk.column}`;
  return `bucket ${chk.id}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const keyEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !keyEnv) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  const c = createClient(url, keyEnv, { auth: { persistSession: false, autoRefreshToken: false } });

  const missing: Check[] = [];
  for (const chk of CHECKS) {
    let ok = false;
    try { ok = await present(c, chk); }
    catch (e) { console.error(`  ? ${label(chk)} — ${(e as Error).message}`); }
    console.log(`  ${ok ? "✓" : "✗"} ${label(chk)}`);
    if (!ok) missing.push(chk);
  }
  console.log("");
  if (missing.length === 0) {
    console.log(`All ${CHECKS.length} objects present — migrations 048–057 are applied. ✅`);
    return;
  }
  const mids = [...new Set(missing.map((m) => m.migration))].sort();
  console.log(`✗ ${missing.length} missing. Run these in the Supabase SQL editor (in order):`);
  for (const m of mids) console.log(`    supabase/migrations/${m}`);
  process.exitCode = 1;
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
