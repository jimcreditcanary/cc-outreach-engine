// Per-campaign rollup of hs_sends for the Campaigns UI. PostgREST has no
// GROUP BY, so we pull the lightweight columns and aggregate in JS (fine at
// campaign scale; capped defensively).

import type { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;

export interface CampaignSummary {
  campaign: string;
  total: number;
  queued: number;
  approved: number;
  sent: number;
  suppressed: number;
  failed: number;
  skipped: number;
  clicked: number;
  replied: number;
  bounced: number;
  lastActivity: string | null;
}

interface Row {
  campaign: string | null;
  status: string;
  clicked: boolean;
  replied: boolean;
  bounced: boolean;
  ts: string;
}

export async function campaignSummaries(db: DB, limit = 20000): Promise<CampaignSummary[]> {
  const { data } = await db
    .from("hs_sends")
    .select("campaign, status, clicked, replied, bounced, ts")
    .order("ts", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as unknown as Row[];

  const map = new Map<string, CampaignSummary>();
  for (const r of rows) {
    const key = r.campaign ?? "(uncategorised)";
    let s = map.get(key);
    if (!s) {
      s = { campaign: key, total: 0, queued: 0, approved: 0, sent: 0, suppressed: 0, failed: 0, skipped: 0, clicked: 0, replied: 0, bounced: 0, lastActivity: null };
      map.set(key, s);
    }
    s.total++;
    switch (r.status) {
      case "queued": s.queued++; break;
      case "approved": s.approved++; break;
      case "sent": s.sent++; break;
      case "suppressed": s.suppressed++; break;
      case "failed": s.failed++; break;
      case "skipped": s.skipped++; break;
    }
    if (r.clicked) s.clicked++;
    if (r.replied) s.replied++;
    if (r.bounced) s.bounced++;
    if (!s.lastActivity || r.ts > s.lastActivity) s.lastActivity = r.ts;
  }
  return [...map.values()].sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
}
