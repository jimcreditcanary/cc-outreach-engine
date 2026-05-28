// Seed MEDDICC for all T1 deals (build brief §8). For each open deal with a
// proposal, populate the MEDDICC layer + ONE next-best-action. Surfaced on
// /t1 and the deal page. Uploading a proposal in the UI now auto-seeds a
// single deal; this re-runs the whole set.
//
//   npm run meddicc

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { seedDealMeddicc } from "../src/lib/meddicc/seedDeal";

config({ path: ".env.local", override: true });

async function main() {
  const db = serviceClient();
  const { data: deals, error } = await db
    .from("deals")
    .select("id, title")
    .eq("status", "open")
    .eq("proposal_exists", true);
  if (error) throw error;

  if (!deals || deals.length === 0) {
    console.log("No T1 deals (open + proposal). Attach proposals first.");
    return;
  }
  console.log(`Seeding MEDDICC for ${deals.length} T1 deal(s)…`);

  for (const d of deals) {
    const gap = await seedDealMeddicc(db, d.id);
    console.log(`  ${d.title}: gap=${gap ?? "(skipped)"}`);
  }
  console.log("Done. Review at /t1.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
