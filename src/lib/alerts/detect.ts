// Alert detection.
//
//   detectPressAlerts — scan recent press signals for organisation names in
//     the CRM. Each match becomes one row in public.alerts, dedup'd by
//     (link + organisation_id) so re-runs are safe.
//
//   detectPostAlerts  — turn freshly-enriched company posts into alerts so
//     they show up alongside press mentions on /alerts.

import type { SupabaseClient } from "@supabase/supabase-js";

interface OrgRow {
  id: string;
  name: string | null;
  owner_id: string | null;
}

interface PressEvent {
  id: string;
  ts: string;
  source: string | null;
  payload: { title?: string; link?: string; summary?: string; feed?: string } | null;
}

interface AlertInsert {
  organisation_id: string;
  owner_id: string | null;
  kind: string;
  title: string;
  link: string | null;
  summary: string | null;
  source: string | null;
  ts: string;
  dedup_key: string;
}

/** Token-match an org name against a press item: case-insensitive whole-word
 *  match against title or summary. Skips two-character names + common
 *  English words to keep noise down. */
function matches(orgName: string, item: { title?: string; summary?: string }): boolean {
  if (!orgName || orgName.length < 3) return false;
  const STOP = new Set(["bank", "card", "credit", "money", "the", "and", "ltd", "limited", "group", "plc"]);
  if (STOP.has(orgName.toLowerCase())) return false;
  const hay = `${item.title ?? ""} ${item.summary ?? ""}`.toLowerCase();
  // \b word boundary; escape regex metas in the org name first.
  const safe = orgName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${safe}\\b`).test(hay);
}

/** Scan the last N days of press events for mentions of any CRM org. One
 *  alert per (org × press item). Returns the number of new alerts inserted. */
export async function detectPressAlerts(db: SupabaseClient, sinceDays = 14): Promise<{ inserted: number }> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const [{ data: pressRows }, { data: orgRows }] = await Promise.all([
    db.from("events").select("id, ts, source, payload").eq("type", "press").gte("ts", since).limit(500),
    db.from("organisations").select("id, name, owner_id").not("name", "is", null).eq("is_partner", false).limit(5000),
  ]);
  const press = (pressRows ?? []) as PressEvent[];
  const orgs = (orgRows ?? []) as OrgRow[];

  const inserts: AlertInsert[] = [];
  for (const p of press) {
    const payload = p.payload ?? {};
    const link = payload.link ?? null;
    if (!link) continue;
    for (const o of orgs) {
      if (!o.name) continue;
      if (!matches(o.name, payload)) continue;
      inserts.push({
        organisation_id: o.id,
        owner_id: o.owner_id,
        kind: "press",
        title: payload.title ?? "(no title)",
        link,
        summary: payload.summary ?? null,
        source: p.source,
        ts: p.ts,
        dedup_key: `press:${o.id}:${link}`,
      });
    }
  }
  if (inserts.length === 0) return { inserted: 0 };
  // Upsert on dedup_key so re-runs are idempotent.
  const { error } = await db.from("alerts").upsert(inserts, { onConflict: "dedup_key", ignoreDuplicates: true });
  if (error) throw error;
  return { inserted: inserts.length };
}

/** Turn a freshly-enriched company's posts list into alerts. Called from
 *  the enrichCompany flow — accepts the posts directly so we don't re-read
 *  the row. */
export async function detectPostAlerts(
  db: SupabaseClient,
  org: { id: string; name: string | null; owner_id: string | null },
  posts: { title: string; url: string; published_at: string | null; summary: string }[],
): Promise<{ inserted: number }> {
  if (!posts.length) return { inserted: 0 };
  const inserts: AlertInsert[] = posts.slice(0, 5).map((p) => ({
    organisation_id: org.id,
    owner_id: org.owner_id,
    kind: "post",
    title: p.title,
    link: p.url,
    summary: p.summary,
    source: "enrichment",
    ts: p.published_at ?? new Date().toISOString(),
    dedup_key: `post:${org.id}:${p.url}`,
  }));
  const { error } = await db.from("alerts").upsert(inserts, { onConflict: "dedup_key", ignoreDuplicates: true });
  if (error) throw error;
  return { inserted: inserts.length };
}
