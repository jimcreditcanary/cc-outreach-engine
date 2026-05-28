// Generate a single draft for a single contact — reuses the same context-
// building, asset selection, and signal matching as the batch generator
// (scripts/generate.ts), so the "Regenerate" button in the queue produces a
// draft identical in quality to a fresh CLI run.

import type { serviceClient } from "../db/client";
import { generateDraft, type AssetOption, type ContactCtx, type DraftResult } from "./draft";
import { matchSignals, type SignalInput } from "../signals/triggers";
import type { Sector } from "../import/mappers";

type DB = ReturnType<typeof serviceClient>;

interface OrgEmbed {
  id: string;
  name: string;
  sector: string | null;
  tier: number | null;
}

/** Run the full draft generator for one contact id. Returns null if the
 *  contact lacks the context to safely draft (no org / no sector). */
export async function regenerateForContact(db: DB, contactId: string): Promise<DraftResult | null> {
  const { data: contact } = await db
    .from("contacts")
    .select("id, full_name, job_title, label, organisation:organisations(id, name, sector, tier)")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return null;
  const org = contact.organisation as unknown as OrgEmbed | null;
  if (!org || !org.sector) return null;

  const { data: assetRows } = await db
    .from("content_assets")
    .select("id, url, title, description, type, tags_problem")
    .contains("tags_sector", [org.sector])
    .limit(15);
  const assets = (assetRows ?? []) as (AssetOption & { id: string })[];

  const { data: notes } = await db
    .from("notes")
    .select("content")
    .eq("organisation_id", org.id)
    .order("noted_at", { ascending: false })
    .limit(3);

  // Recent press signals matched to this sector.
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const { data: press } = await db
    .from("events")
    .select("payload, source")
    .eq("type", "press")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(120);
  const recentSignals: SignalInput[] = (press ?? []).map((p) => {
    const pl = p.payload as { title?: string; summary?: string; link?: string };
    return { title: pl.title ?? "", summary: pl.summary ?? null, link: pl.link ?? "", source: String(p.source ?? "") };
  });

  const ctx: ContactCtx = {
    first_name: String(contact.full_name ?? "there").trim().split(/\s+/)[0] || "there",
    full_name: String(contact.full_name ?? ""),
    job_title: contact.job_title as string | null,
    org_name: org.name,
    sector: org.sector,
    tier: org.tier,
    label: contact.label as string | null,
    notes: (notes ?? []).map((n) => String(n.content)).filter(Boolean),
  };
  const signals = matchSignals(recentSignals, org.sector as Sector);
  return generateDraft(ctx, assets, signals);
}
