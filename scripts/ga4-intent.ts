// Pull GA4 site visits by cc_cid and raise high-intent follow-up tasks in
// HubSpot for contacts over the page-view threshold. Same job the cron runs.
//
//   npm run ga4-intent -- --window=7 --min=2

import { config } from "dotenv";
config({ path: ".env.local", override: true });

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const { ga4Enabled } = await import("../src/lib/ga4/client");
  const { runGa4Intent } = await import("../src/lib/mailer/intent");
  if (!ga4Enabled()) {
    console.error("✗ GA4 not configured — set GA4_PROPERTY_ID + GOOGLE_APPLICATION_CREDENTIALS_JSON in .env.local.");
    process.exit(1);
  }
  const res = await runGa4Intent(serviceClient(), {
    windowDays: flag("window") ? Number(flag("window")) : undefined,
    minPageViews: flag("min") ? Number(flag("min")) : undefined,
  });
  console.log(`GA4 intent: ${res.contacts} cc_cids seen · ${res.highIntent} high-intent · ${res.tasked} tasked · ${res.skipped} already-tasked.`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
