// Mirror HubSpot (contacts / companies / deals) into the Supabase hs_mirror_*
// tables — the daily disaster-recovery snapshot. Run all, or name objects.
//
//   npm run hubspot-mirror                 # all three
//   npm run hubspot-mirror -- companies    # just companies

import { config } from "dotenv";
config({ path: ".env.local", override: true });

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--")) as ("companies" | "contacts" | "deals")[];
  const { serviceClient } = await import("../src/lib/db/client");
  const { runHubspotMirror } = await import("../src/lib/mirror/hubspot");

  console.log(`Mirroring HubSpot → Supabase${only.length ? ` (${only.join(", ")})` : ""}…`);
  const res = await runHubspotMirror(serviceClient(), only.length ? { only } : {});
  for (const o of res.objects) {
    console.log(`  ${o.ok ? "✓" : "✗"} ${o.object_type}: fetched ${o.fetched}, upserted ${o.upserted}${o.error ? ` — ${o.error}` : ""}`);
  }
  console.log(res.ok ? "\nMirror complete." : "\nMirror finished WITH ERRORS.");
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => { console.error("✗", (e as Error)?.message ?? e); process.exit(1); });
