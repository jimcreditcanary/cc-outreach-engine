// Inbound follow-ups. Lead capture / abandonment enqueue a lightweight marker
// (fast); runInboundFollowups then researches + drafts a personalised,
// event-aware follow-up per contact into the review queue. "Strike while warm"
// without slowing the public lead API.

import type { serviceClient } from "../db/client";
import { hubspotRepo } from "../hubspot/repo";
import { researchContact } from "./research";
import { draftEmail, DEFAULT_DRAFT_CONFIG, type DraftConfig } from "./draft";
import { textToHtml } from "./render";
import { insertDraft } from "./workflow";

type DB = ReturnType<typeof serviceClient>;

export interface InboundEvent {
  hsContactId: string;
  kind: "download" | "enquiry" | "abandonment" | "booking";
  asset?: string | null;
  page?: string | null;
  ownerId?: string | null;
}

/** Fast, best-effort enqueue — called from the lead API path. Never throws. */
export async function enqueueInboundFollowup(db: DB, ev: InboundEvent): Promise<void> {
  try {
    await db.from("inbound_followups").insert({
      hs_contact_id: ev.hsContactId, kind: ev.kind, asset: ev.asset ?? null, page: ev.page ?? null, owner_id: ev.ownerId ?? null,
    });
  } catch { /* table not migrated yet / transient — don't block the lead */ }
}

function triggerNote(kind: string, asset: string | null, page: string | null): string {
  switch (kind) {
    case "download": return `They just downloaded ${asset ? `"${asset}"` : "a resource"} from the Credit Canary website — follow up warmly, reference it, and point them to the natural next thing.`;
    case "enquiry": return `They just sent an enquiry via the website${asset ? ` about ${asset}` : ""} — respond helpfully and move to a conversation.`;
    case "abandonment": return `They were looking at ${page ?? "the website"} recently but didn't get in touch — a light, useful nudge, no pressure.`;
    case "booking": return `They just booked a meeting — a warm pre-meeting note that adds value.`;
    default: return "They recently engaged with Credit Canary.";
  }
}

export interface InboundRunResult { pending: number; drafted: number; skipped: number; failed: number }

export async function runInboundFollowups(db: DB, opts: { limit?: number; config?: DraftConfig } = {}): Promise<InboundRunResult> {
  const cfg = opts.config ?? DEFAULT_DRAFT_CONFIG;
  const limit = opts.limit ?? 25;
  const { data: pending } = await db.from("inbound_followups").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(limit);
  const rows = (pending ?? []) as { id: string; hs_contact_id: string; kind: string; asset: string | null; page: string | null; owner_id: string | null }[];
  const res: InboundRunResult = { pending: rows.length, drafted: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      const contact = await hubspotRepo.getContact(row.hs_contact_id);
      if (!contact?.email || contact.email_bounced) { await mark(db, row.id, "skipped"); res.skipped++; continue; }
      const { data: active } = await db.from("hs_sends").select("id").eq("hs_contact_id", row.hs_contact_id).in("status", ["queued", "approved"]).limit(1);
      if (active && active.length) { await mark(db, row.id, "skipped"); res.skipped++; continue; }

      const company = contact.company_id ? await hubspotRepo.getCompany(contact.company_id) : null;
      let contactContext = contact.context;
      let confidence: "high" | "medium" | "low" = contact.context ? "medium" : "low";
      if (!contact.context) {
        const r = await researchContact({ full_name: contact.full_name, job_title: contact.job_title, company_name: company?.name ?? contact.company_name, domain: company?.website ?? company?.domain ?? null, industry: company?.industry ?? null });
        confidence = r.confidence;
        contactContext = `${r.context_md.trim()}\n\n_Problem: ${r.problem_statement ?? "—"} · confidence: ${r.confidence} · updated ${new Date().toISOString().slice(0, 10)}_`;
        await hubspotRepo.updateContact(contact.id, { context: contactContext });
      }

      const draft = await draftEmail({
        first_name: contact.full_name?.split(/\s+/)[0] ?? null, full_name: contact.full_name, job_title: contact.job_title,
        company_name: company?.name ?? contact.company_name, industry: company?.industry ?? null,
        company_context: company?.context ?? null, contact_context: contactContext,
        trigger_note: triggerNote(row.kind, row.asset, row.page),
      }, cfg);

      await insertDraft(db, {
        hs_contact_id: contact.id, email: contact.email, campaign: `inbound-${row.kind}`,
        subject: draft.subject, body_text: draft.body, body_html: textToHtml(draft.body),
        status: "queued", owner_id: row.owner_id,
        meta: { contact_name: contact.full_name, confidence, kind: "inbound", trigger: row.kind, asset: row.asset, page_url: draft.page_url, page_title: draft.page_title, angle: draft.angle },
      });
      await mark(db, row.id, "drafted");
      res.drafted++;
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      res.failed++;
    }
  }
  return res;
}

async function mark(db: DB, id: string, status: string): Promise<void> {
  await db.from("inbound_followups").update({ status, processed_at: new Date().toISOString() }).eq("id", id);
}
