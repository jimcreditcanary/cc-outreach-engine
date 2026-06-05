// Weekly alerts cron — Sundays 22:00 UTC. Two passes:
//
//   1. PRESS DETECTION. Scan the last 14 days of press events (refreshed
//      every weekday morning by /api/cron/daily) for org-name mentions.
//      Strict matching: whole word, case-insensitive, 3-char minimum,
//      English/banking stop-words excluded. New matches → alerts row,
//      idempotent via dedup_key. Sparse-but-gold: if Capital Credit Union
//      shows up in an FCA enforcement headline, you want to know.
//
//   2. ROLLING ENRICHMENT. Pick up to MAX_PER_RUN companies whose
//      enriched_at is NULL or older than STALE_DAYS, with a website set
//      and not flagged as a partner. Call enrichCompany on each — that
//      re-scrapes the homepage, regenerates the AI summary, parses the
//      blog feed, AND fires detectPostAlerts to drop fresh posts onto
//      /alerts. Costs roughly 1p per company in Anthropic spend.
//
// Per-company errors are caught + reported but don't abort the batch.
// Guarded by CRON_SECRET like every other cron.

import { serviceClient } from "@/lib/db/client";
import { detectPressAlerts } from "@/lib/alerts/detect";
import { enrichCompany } from "@/lib/enrich/company";

// Allow ~5 min — at 25–30s per enrich worst-case for slow company
// websites, 100 enrichments can need most of that runway.
export const maxDuration = 300;

const MAX_PER_RUN = 100;
const STALE_DAYS = 14;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const db = serviceClient();
  const errors: string[] = [];

  // ── 1) Press → alerts ────────────────────────────────────────────
  let pressInserted = 0;
  try {
    const res = await detectPressAlerts(db, 14);
    pressInserted = res.inserted;
  } catch (e) {
    errors.push(`press: ${(e as Error).message}`);
  }

  // ── 2) Rolling enrichment of stale companies ─────────────────────
  // enriched_at IS NULL OR < now - STALE_DAYS. Oldest first so the
  // backlog is the queue.
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  const { data: stale, error: staleErr } = await db
    .from("organisations")
    .select("id, name, enriched_at")
    .eq("is_partner", false)
    .not("website", "is", null)
    .or(`enriched_at.is.null,enriched_at.lt.${staleCutoff}`)
    .order("enriched_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);
  if (staleErr) errors.push(`load stale: ${staleErr.message}`);

  let enriched = 0;
  let postAlertsInserted = 0;
  let skippedNoWebsite = 0;
  const enrichErrors: string[] = [];
  for (const o of stale ?? []) {
    try {
      // enrichCompany also calls detectPostAlerts internally — fresh
      // blog posts surface on /alerts as a side effect. We don't get a
      // separate count back so postAlertsInserted is best-effort by
      // counting alerts rows tagged 'post' created since "now-1min" at
      // the end of the run (below).
      await enrichCompany(db, o.id as string);
      enriched++;
    } catch (e) {
      const msg = (e as Error).message;
      if (/no website/i.test(msg)) skippedNoWebsite++;
      else enrichErrors.push(`${o.name ?? o.id}: ${msg.slice(0, 100)}`);
    }
  }
  // Cheap post-hoc count of post alerts surfaced during the enrich loop.
  // Bounded by MAX_PER_RUN * 5 (detectPostAlerts caps at 5 posts/org).
  // NB: alerts.ts is the post's published_at when set, falling back to
  // now() — so a 10-min lookback can miss old-but-newly-discovered
  // posts. Best-effort count; the real source of truth is the /alerts
  // page itself which renders everything anyway.
  const sinceRunStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: postsCount } = await db
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("kind", "post")
    .gte("ts", sinceRunStart);
  postAlertsInserted = postsCount ?? 0;

  return Response.json({
    ok: true,
    press_alerts_upserted: pressInserted,
    enrichment: {
      candidates: (stale ?? []).length,
      enriched,
      skipped_no_website: skippedNoWebsite,
      post_alerts_inserted: postAlertsInserted,
      errors: enrichErrors.slice(0, 10),
    },
    errors,
  });
}
