// Shared signal-refresh routine, used by both `npm run signals` and the daily
// cron route. Fetches the feeds, dedupes by link, records new `press` events.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseFeed } from "./rss";
import { FEEDS } from "./feeds";

const UA = "CreditCanaryOutreach/1.0 (+https://creditcanary.co.uk)";
const PER_FEED = 30;

export async function refreshSignals(db: SupabaseClient): Promise<{ inserted: number; log: string[] }> {
  const log: string[] = [];
  const { data: existing } = await db.from("events").select("payload").eq("type", "press").limit(5000);
  const seen = new Set((existing ?? []).map((e) => (e.payload as { link?: string })?.link).filter(Boolean));

  let inserted = 0;
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        log.push(`${res.status} ${feed.name}`);
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
      log.push(`${feed.name}: ${items.length} items, ${feedNew} new`);
    } catch (e) {
      log.push(`FAIL ${feed.name}: ${(e as Error).message}`);
    }
  }
  return { inserted, log };
}
