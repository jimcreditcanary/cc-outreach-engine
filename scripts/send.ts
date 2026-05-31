// Send worker (build brief §8/§11): drains approved drafts.
//
//   npm run send                 send up to a batch within guardrails
//   npm run send -- 10           cap this run to 10
//   npm run send -- 10 --force   ignore the sending-window check
//
// Thin CLI wrapper around runSendBatch — same function the cron uses.

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { runSendBatch } from "../src/lib/send/runBatch";

config({ path: ".env.local", override: true });

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const batchArg = args.find((a) => /^\d+$/.test(a));
  const batch = batchArg ? Number(batchArg) : 10;

  const db = serviceClient();
  const res = await runSendBatch(db, { batch, force });

  if (!res.ok) {
    console.error(res.reason);
    process.exit(1);
  }
  if (res.reason) console.log(res.reason);
  console.log(
    `${res.dry ? "[DRY RUN] " : ""}cap ${res.cap}, sent today ${res.sentToday}, attempted ${res.attempted}, sent ${res.sent}, skipped ${res.skipped}, failed ${res.failed}.`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
