// Signal monitor (build brief §6/§11). Pulls the regulatory/industry feeds
// (FCA, BoE) and records new items as `press` events. Deduped by link.
//
//   npm run signals

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { refreshSignals } from "../src/lib/signals/refresh";

config({ path: ".env.local", override: true });

async function main() {
  const { inserted, log } = await refreshSignals(serviceClient());
  for (const line of log) console.log(`  ${line}`);
  console.log(`Recorded ${inserted} new press signals.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
