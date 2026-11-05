// Wipe all onboarding data so the flow can be retested from scratch. Dry run by
// default. Add --apply to wipe every public table named onboarding_* (metadata,
// answers, upload records, cases) + clear the onboarding-uploads Storage bucket.
// Does NOT touch billing, CRM or customer flags. Uses the REST API (the direct
// Postgres host isn't reachable from here); tables are discovered from the
// PostgREST schema so none are missed, and deletes run in repeated passes so FK
// ordering sorts itself out (onboarding_cases last).

import { config } from "dotenv";
config({ path: ".env.local", override: true });

async function main() {
  const apply = process.argv.includes("--apply");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!base || !key) throw new Error("Missing SUPABASE url/service key");

  // Discover onboarding_* tables + a non-null filter column from the OpenAPI spec.
  const spec = await fetch(`${base}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then((r) => r.json());
  const defs = (spec.definitions ?? {}) as Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  const tables = Object.keys(defs).filter((t) => t.startsWith("onboarding")).sort();
  const filterCol = (t: string): string => {
    const props = Object.keys(defs[t]?.properties ?? {});
    if (props.includes("id")) return "id";
    if (props.includes("case_id")) return "case_id";
    return defs[t]?.required?.[0] ?? props[0] ?? "id";
  };

  const { serviceClient } = await import("../src/lib/db/client");
  const db = serviceClient();

  console.log(`Onboarding tables (${tables.length}) + row counts:`);
  let total = 0;
  for (const t of tables) {
    const { count } = await db.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t.padEnd(38)} ${count ?? 0}`);
    total += count ?? 0;
  }

  if (!apply) {
    console.log(`\nDRY RUN — ${total} rows across ${tables.length} tables. Re-run with --apply to wipe (billing/CRM untouched).`);
    return;
  }

  // Cases last; a few passes so inter-table FKs clear regardless of order.
  const order = [...tables.filter((t) => t !== "onboarding_cases"), ...tables.filter((t) => t === "onboarding_cases")];
  for (let pass = 1; pass <= 4; pass++) {
    let remaining = 0;
    for (const t of order) {
      const col = filterCol(t);
      const { error } = await db.from(t).delete().not(col, "is", null);
      if (error) remaining++;
    }
    const { count } = await db.from("onboarding_cases").select("*", { count: "exact", head: true });
    if (!remaining && (count ?? 0) === 0) break;
  }
  // Report final counts.
  let left = 0;
  for (const t of tables) { const { count } = await db.from(t).select("*", { count: "exact", head: true }); left += count ?? 0; }
  console.log(`\n${left === 0 ? "✓" : "⚠"} Wiped ${total - left} rows; ${left} remaining across ${tables.length} onboarding tables.`);

  // Clear the private uploads bucket.
  try {
    const bucket = "onboarding-uploads";
    let removed = 0;
    const walk = async (prefix: string) => {
      const { data } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
      const files: string[] = [];
      for (const e of data ?? []) {
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        if ((e as { id: string | null }).id === null) await walk(p); else files.push(p);
      }
      if (files.length) { await db.storage.from(bucket).remove(files); removed += files.length; }
    };
    await walk("");
    console.log(`✓ Cleared ${removed} file(s) from the ${bucket} Storage bucket.`);
  } catch (e) {
    console.log(`(Storage bucket not cleared: ${(e as Error).message})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
