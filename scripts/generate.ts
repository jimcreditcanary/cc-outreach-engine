// Generate drafts into the approval queue (build brief step 4 / §14).
//
//   npm run generate -- [limit]      (default 5)
//
// Thin CLI wrapper around runGenerateBatch — the same function the cron
// route uses, so script + cron produce identical drafts.

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { runGenerateBatch } from "../src/lib/generate/runBatch";

config({ path: ".env.local", override: true });

async function main() {
  const limit = Number(process.argv[2] ?? 5);
  const db = serviceClient();
  const res = await runGenerateBatch(db, limit);
  console.log(`${res.due} due contacts; queued ${res.queued}, flagged ${res.flagged}.`);
  for (const d of res.drafts) {
    console.log(`  - ${d.contact} @ ${d.org} — "${d.subject}" [${d.angle}]`);
  }
  console.log("Review with: npm run review");
}

main().catch((e) => { console.error(e); process.exit(1); });
