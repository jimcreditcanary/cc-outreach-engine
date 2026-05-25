// Preflight: confirm the service-role key connects and the schema is in
// place before importing. Run: npx tsx scripts/preflight.ts
import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";

config({ path: ".env.local" });

async function main() {
  const db = serviceClient();
  for (const t of ["organisations", "contacts", "deals", "notes"]) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t}: ${error ? `ERROR — ${error.message}` : `${count} rows`}`);
  }
  const { error } = await db
    .from("organisations")
    .select("icp,customer_sub_category,partner_category,label")
    .limit(1);
  console.log(`  org targeting+label cols: ${error ? `MISSING — ${error.message}` : "present"}`);
}

main().catch((e) => {
  console.error("preflight failed:", e.message);
  process.exit(1);
});
