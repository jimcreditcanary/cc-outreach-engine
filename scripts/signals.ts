// Signal monitor (build brief §6/§11). Pulls the regulatory/industry feeds
// (FCA, BoE) and records new items as `press` events — the raw material for
// regulatory-trigger angle selection and the daily company-signal review.
//
//   npm run signals
//
// Deduped by link, so it's safe to run repeatedly (cron later).

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { parseFeed } from "../src/lib/signals/rss";
import { FEEDS } from "../src/lib/signals/feeds";

config({ path: ".env.local", override: true });

const UA = "CreditCanaryOutreach/1.0 (+https://creditcanary.co.uk)";
const PER_FEED = 30;

async function main() {
  const db = serviceClient();

  // Existing press links → skip dupes.
  const { data: existing } = await db.from("events").select("payload").eq("type", "press").limit(5000);
  const seen = new Set((existing ?? []).map((e) => (e.payload as { link?: string })?.link).filter(Boolean));

  let inserted = 0;
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        console.warn(`  ${res.status} ${feed.name}`);
        continue;
      }
      const items = parseFeed(await res.text()).slice(0, PER_FEED);
      let feedNew = 0;
      for (const it of items) {
        if (seen.has(it.link)) continue;
        seen.add(it.link);
        const ts = it.published ? new Date(it.published) : new Date();
        const { error } = await db.from("events").insert({
          type: "press",
          source: feed.source,
          payload: { title: it.title, link: it.link, summary: it.summary ?? null, feed: feed.name },
          ts: Number.isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(),
        });
        if (error) throw error;
        feedNew++;
        inserted++;
      }
      console.log(`  ${feed.name}: ${items.length} items, ${feedNew} new`);
    } catch (e) {
      console.warn(`  FAIL ${feed.name}: ${(e as Error).message}`);
    }
  }

  console.log(`Recorded ${inserted} new press signals.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
