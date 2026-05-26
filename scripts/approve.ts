// Approve queued drafts (build brief §14 — approval queue).
//
//   npm run approve -- all          approve every queued draft
//   npm run approve -- <id> [<id>]  approve specific send rows

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";

config({ path: ".env.local", override: true });

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: approve <all | sendId...>");
    process.exit(1);
  }
  const db = serviceClient();

  let q = db.from("sends").update({ status: "approved" }).eq("status", "queued");
  if (args[0] !== "all") q = q.in("id", args);

  const { data, error } = await q.select("id");
  if (error) throw error;
  console.log(`Approved ${data?.length ?? 0} draft(s). Send with: npm run send`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
