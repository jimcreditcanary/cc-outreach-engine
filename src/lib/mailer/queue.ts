// Queue a campaign: resolve the HubSpot segment, drop anyone suppressed, in
// cooldown, or already in this campaign, render per-recipient, and insert
// hs_sends rows as 'queued' (approval-queue-first — nothing sends here).

import type { serviceClient } from "../db/client";
import { fetchAudience } from "./audience";
import { renderTemplate, textToHtml } from "./render";
import { segmentLabel, type Segment } from "./types";

type DB = ReturnType<typeof serviceClient>;

export interface QueueCampaignInput {
  segment: Segment;
  campaign: string;
  subject: string;
  bodyTemplate: string;
  cooldownDays?: number;
  ownerId?: string | null;
  cap?: number;
}

export interface QueueResult {
  audience: number;
  queued: number;
  skippedSuppressed: number;
  skippedRecent: number;
}

export async function queueCampaign(db: DB, input: QueueCampaignInput): Promise<QueueResult> {
  const cooldownDays = input.cooldownDays ?? 28;
  const audience = await fetchAudience(input.segment, input.cap ?? 2000);

  // Suppressions (email-keyed, shared with the Supabase mailer).
  const { data: supp } = await db.from("suppressions").select("email");
  const suppressed = new Set((supp ?? []).map((s) => String((s as { email: string }).email).toLowerCase()));

  // Cadence: skip contacts emailed within the cooldown window.
  const cutoff = new Date(Date.now() - cooldownDays * 86_400_000).toISOString();
  const { data: recent } = await db.from("hs_sends").select("hs_contact_id").eq("status", "sent").gte("sent_at", cutoff);
  const recentIds = new Set((recent ?? []).map((r) => String((r as { hs_contact_id: string }).hs_contact_id)));

  // Don't double-queue the same campaign.
  const { data: already } = await db.from("hs_sends").select("hs_contact_id").eq("campaign", input.campaign).in("status", ["queued", "approved", "sent"]);
  const alreadyIds = new Set((already ?? []).map((r) => String((r as { hs_contact_id: string }).hs_contact_id)));

  let queued = 0, skippedSuppressed = 0, skippedRecent = 0;
  const rows: Record<string, unknown>[] = [];
  for (const a of audience) {
    if (suppressed.has(a.email)) { skippedSuppressed++; continue; }
    if (recentIds.has(a.hs_contact_id) || alreadyIds.has(a.hs_contact_id)) { skippedRecent++; continue; }
    const vars = { first_name: a.first_name, company: a.company_name };
    const text = renderTemplate(input.bodyTemplate, vars);
    rows.push({
      hs_contact_id: a.hs_contact_id,
      email: a.email,
      campaign: input.campaign,
      subject: renderTemplate(input.subject, vars),
      body_text: text,
      body_html: textToHtml(text),
      status: "queued",
      owner_id: input.ownerId ?? null,
    });
    queued++;
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("hs_sends").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }

  return { audience: audience.length, queued, skippedSuppressed, skippedRecent };
}

/** Approve queued rows for a campaign (or all). Returns the count moved. */
export async function approveCampaign(db: DB, campaign: string | null): Promise<number> {
  let q = db.from("hs_sends").update({ status: "approved" }).eq("status", "queued");
  if (campaign) q = q.eq("campaign", campaign);
  const { data, error } = await q.select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export { segmentLabel };
