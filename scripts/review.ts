// List queued drafts (the approval queue) for review.
//
//   npm run review

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";

config({ path: ".env.local", override: true });

async function main() {
  const db = serviceClient();
  const { data, error } = await db
    .from("sends")
    .select("id, subject, body_text, angle, ts, contact:contacts(full_name, email, organisation:organisations(name, sector))")
    .eq("status", "queued")
    .order("ts", { ascending: false });
  if (error) throw error;

  const drafts = data ?? [];
  if (drafts.length === 0) {
    console.log("No queued drafts. Generate some with: npm run generate");
    return;
  }

  console.log(`${drafts.length} queued draft(s):\n`);
  for (const d of drafts) {
    const c = d.contact as unknown as { full_name: string; email: string; organisation: { name: string; sector: string } | null };
    console.log("═".repeat(72));
    console.log(`To:      ${c?.full_name} <${c?.email}>  —  ${c?.organisation?.name} (${c?.organisation?.sector})`);
    console.log(`Angle:   ${d.angle}`);
    console.log(`Subject: ${d.subject}`);
    console.log("─".repeat(72));
    console.log(d.body_text);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
