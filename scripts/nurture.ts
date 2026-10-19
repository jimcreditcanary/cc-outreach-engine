// Weekly deal-nurture run: appraise the owner's open deals (MEDDICC) and draft a
// next-step nudge to each deal's contact into the review queue. Deals contacted
// within the last week are skipped ("already in comms"). Review + send via
// npm run hs-mailer / the Outreach page.
//
//   npm run nurture -- --limit=15
//   npm run nurture -- --owner=86510668 --dry

import { config } from "dotenv";
config({ path: ".env.local", override: true });

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const has = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const { runDealNurture } = await import("../src/lib/mailer/nurture");

  const ownerHubspotId = flag("owner") ?? process.env.HUBSPOT_LEAD_OWNER_ID ?? "86510668";
  const db = serviceClient();
  console.log(`Deal nurture · owner ${ownerHubspotId} · limit ${flag("limit") ?? 25}${has("dry") ? " · DRY" : ""}`);

  const res = await runDealNurture(db, {
    ownerHubspotId,
    limit: flag("limit") ? Number(flag("limit")) : undefined,
    cooldownDays: flag("cooldown") ? Number(flag("cooldown")) : undefined,
    dry: has("dry"),
    onProgress: (m) => console.log(`  ${m}`),
  });

  console.log(`\nOpen deals ${res.deals} → drafted ${res.queued} to review (skipped ${res.skippedRecent} in-comms/active, ${res.skippedNoContact} no-contact, ${res.failed} failed).`);
  console.log(has("dry") ? "Dry run — nothing written." : "Review + send in the Outreach tab, or: npm run hs-mailer -- list / approve / send");
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
