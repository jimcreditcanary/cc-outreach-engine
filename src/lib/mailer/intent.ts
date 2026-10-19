// GA4 high-intent ingestion. Pulls site visits by cc_cid (= HubSpot contact id)
// from GA4, and for contacts above a page-view threshold raises a high-intent
// follow-up task in HubSpot — deduped via intent_signals so we don't re-task the
// same person each run. The deep end of "stay present, pounce on intent".

import type { serviceClient } from "../db/client";
import { ga4Enabled, runReport } from "../ga4/client";
import { createContactTask } from "../hubspot/repo";
import { DEFAULT_HS_OWNER } from "../hubspot/owner";

type DB = ReturnType<typeof serviceClient>;

export interface IntentResult { enabled: boolean; contacts: number; highIntent: number; tasked: number; skipped: number }

export async function runGa4Intent(db: DB, opts: { windowDays?: number; minPageViews?: number } = {}): Promise<IntentResult> {
  if (!ga4Enabled()) return { enabled: false, contacts: 0, highIntent: 0, tasked: 0, skipped: 0 };
  const windowDays = opts.windowDays ?? 7;
  const minPV = opts.minPageViews ?? 2;

  const rows = await runReport({
    dateRanges: [{ startDate: `${windowDays}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "customEvent:cc_cid" }],
    metrics: [{ name: "screenPageViews" }],
    dimensionFilter: { filter: { fieldName: "customEvent:cc_cid", stringFilter: { matchType: "FULL_REGEXP", value: ".+" } } },
    limit: 2000,
  });

  const res: IntentResult = { enabled: true, contacts: rows.length, highIntent: 0, tasked: 0, skipped: 0 };
  const cutoff = Date.now() - windowDays * 86_400_000;

  for (const row of rows) {
    const cid = row.dimensionValues?.[0]?.value?.trim();
    const pv = Number(row.metricValues?.[0]?.value ?? 0);
    if (!cid || cid === "(not set)" || cid === "(other)" || pv < minPV) continue;
    res.highIntent++;

    // Dedup: already tasked for this contact within the window?
    const { data: seen } = await db.from("intent_signals").select("tasked_at").eq("hs_contact_id", cid).maybeSingle();
    const lastTasked = (seen as { tasked_at: string | null } | null)?.tasked_at;
    if (lastTasked && new Date(lastTasked).getTime() > cutoff) { res.skipped++; continue; }

    const ok = await createContactTask(cid, {
      subject: `🔥 High intent: ${pv} site visits`,
      body: `Visited creditcanary.co.uk ${pv}× in the last ${windowDays} days (via an outreach link). Strong buying signal — reach out.`,
      ownerId: DEFAULT_HS_OWNER,
      priority: "HIGH",
    });
    await db.from("intent_signals").upsert(
      { hs_contact_id: cid, pageviews: pv, window_days: windowDays, tasked_at: ok ? new Date().toISOString() : lastTasked ?? null, updated_at: new Date().toISOString() },
      { onConflict: "hs_contact_id" },
    );
    if (ok) res.tasked++;
  }
  return res;
}
