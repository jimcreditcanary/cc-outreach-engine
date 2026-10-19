// Process pending inbound follow-ups (download / enquiry / abandonment) into
// personalised drafts in the review queue. Same job the cron runs.
//
//   npm run inbound-followups -- --limit=25

import { config } from "dotenv";
config({ path: ".env.local", override: true });

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const { runInboundFollowups } = await import("../src/lib/mailer/inbound");
  const res = await runInboundFollowups(serviceClient(), { limit: flag("limit") ? Number(flag("limit")) : undefined });
  console.log(`Inbound follow-ups: ${res.pending} pending → ${res.drafted} drafted, ${res.skipped} skipped, ${res.failed} failed.`);
  console.log("Review + send in the Outreach tab.");
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
