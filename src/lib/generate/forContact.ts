// Generate a single draft for a single contact — reuses the same context-
// building, asset selection, and signal matching as the batch generator
// (scripts/generate.ts), so the "Regenerate" button in the queue produces a
// draft identical in quality to a fresh CLI run.

import type { serviceClient } from "../db/client";
import { generateDraft, type AssetOption, type ContactCtx, type DraftResult } from "./draft";
import { matchSignals, type SignalInput } from "../signals/triggers";
import { resolveSender } from "./sender";
import type { Sector } from "../import/mappers";

type DB = ReturnType<typeof serviceClient>;

interface OrgEmbed {
  id: string;
  name: string;
  sector: string | null;
  tier: number | null;
}

/** Run the full draft generator for one contact id. Returns null if the
 *  contact lacks the context to safely draft (no org / no sector).
 *  Optional `theme` + `step_kind` get threaded into the prompt — used by
 *  the sequences engine so each step generates in the right voice.
 *  Optional `ownerOverride` lets callers (the sequence engine, typically)
 *  pin the sender to the sequence's owner instead of the contact's owner
 *  — important when an operator runs a sequence over a shared list. */
export async function regenerateForContact(
  db: DB,
  contactId: string,
  opts: { theme?: string | null; step_kind?: ContactCtx["step_kind"]; ownerOverride?: string | null } = {},
): Promise<DraftResult | null> {
  const { data: contact } = await db
    .from("contacts")
    .select("id, full_name, email, job_title, label, owner_id, organisation:organisations(id, name, sector, tier)")
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

  const [{ data: notes }, { data: enriched }] = await Promise.all([
    db.from("notes").select("content").eq("organisation_id", org.id).order("noted_at", { ascending: false }).limit(3),
    db.from("organisations").select("company_summary, recent_posts").eq("id", org.id).maybeSingle(),
  ]);
  const posts = (enriched?.recent_posts ?? []) as { title: string; published_at: string | null }[];

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
    email: String(contact.email ?? ""),
    job_title: contact.job_title as string | null,
    org_name: org.name,
    sector: org.sector,
    tier: org.tier,
    label: contact.label as string | null,
    notes: (notes ?? []).map((n) => String(n.content)).filter(Boolean),
    org_summary: (enriched?.company_summary as string | null) ?? null,
    recent_posts: posts.slice(0, 3),
    theme: opts.theme ?? null,
    step_kind: opts.step_kind ?? null,
  };
  const signals = matchSignals(recentSignals, org.sector as Sector);

  // Resolve the SENDER — overrides win (sequence engine passes the
  // sequence's owner); otherwise use the contact's owner; otherwise
  // workspace default. This is what threads the operator's name +
  // signoff + reply-to-email through into the prompt and signature.
  const ownerId =
    opts.ownerOverride !== undefined
      ? opts.ownerOverride
      : ((contact.owner_id as string | null) ?? null);
  const sender = await resolveSender(db, ownerId);

  return generateDraft(ctx, assets, signals, sender);
}
