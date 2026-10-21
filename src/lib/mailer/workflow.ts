// The keystone: turn a HubSpot segment into reviewed, personalised drafts.
// Per eligible contact → research (if no Context yet) → draft in the rep's voice
// → insert an hs_sends row. High research-confidence drafts are auto-approved
// (ready to send); the rest are queued for review. The existing send runner
// then sends the approved queue slowly, with guardrails + activity logging.

import type { serviceClient } from "../db/client";
import { fetchAudience } from "./audience";
import { researchContact } from "./research";
import { draftEmail, DEFAULT_DRAFT_CONFIG, type DraftConfig } from "./draft";
import { textToHtml } from "./render";
import { hubspotRepo } from "../hubspot/repo";
import type { Segment } from "./types";

type DB = ReturnType<typeof serviceClient>;

export interface WorkflowOpts {
  segment: Segment;
  campaign: string;
  limit?: number;
  cooldownDays?: number;
  ownerId?: string | null;
  config?: DraftConfig;
  /** High research-confidence → auto-approved; else queued for review. */
  autoSendHigh?: boolean;
  /** Research + write Context when a contact has none (default true). */
  research?: boolean;
  dry?: boolean;
  onProgress?: (msg: string) => void;
}

export interface WorkflowResult {
  audience: number;
  processed: number;
  queued: number;
  approved: number;
  skippedSuppressed: number;
  skippedRecent: number;
  failed: number;
}

export async function runDraftWorkflow(db: DB, opts: WorkflowOpts): Promise<WorkflowResult> {
  const cfg = opts.config ?? DEFAULT_DRAFT_CONFIG;
  const cooldownDays = opts.cooldownDays ?? 60; // ~2 months between touches (strategy)
  const autoSendHigh = opts.autoSendHigh ?? true;
  const doResearch = opts.research ?? true;
  const limit = opts.limit ?? 25;
  const log = opts.onProgress ?? (() => {});

  const audience = await fetchAudience(opts.segment, Math.max(limit * 4, 100));

  const { data: supp } = await db.from("suppressions").select("email");
  const suppressed = new Set((supp ?? []).map((s) => String((s as { email: string }).email).toLowerCase()));
  const cutoff = new Date(Date.now() - cooldownDays * 86_400_000).toISOString();
  const { data: recent } = await db.from("hs_sends").select("hs_contact_id").eq("status", "sent").gte("sent_at", cutoff);
  const recentIds = new Set((recent ?? []).map((r) => String((r as { hs_contact_id: string }).hs_contact_id)));
  const { data: active } = await db.from("hs_sends").select("hs_contact_id").in("status", ["queued", "approved", "sent"]);
  const activeIds = new Set((active ?? []).map((r) => String((r as { hs_contact_id: string }).hs_contact_id)));

  const res: WorkflowResult = { audience: audience.length, processed: 0, queued: 0, approved: 0, skippedSuppressed: 0, skippedRecent: 0, failed: 0 };

  for (const a of audience) {
    if (res.processed >= limit) break;
    if (suppressed.has(a.email)) { res.skippedSuppressed++; continue; }
    if (recentIds.has(a.hs_contact_id) || activeIds.has(a.hs_contact_id)) { res.skippedRecent++; continue; }

    try {
      const contact = await hubspotRepo.getContact(a.hs_contact_id);
      if (!contact?.email) continue;
      if (contact.email_bounced) { res.skippedSuppressed++; continue; }
      const company = contact.company_id ? await hubspotRepo.getCompany(contact.company_id) : null;

      // Research → Context when missing.
      let contactContext = contact.context;
      let confidence: "high" | "medium" | "low" = contact.context ? "medium" : "low";
      if (doResearch && !contact.context) {
        const r = await researchContact({
          full_name: contact.full_name, job_title: contact.job_title,
          company_name: company?.name ?? contact.company_name,
          domain: company?.website ?? company?.domain ?? null, industry: company?.industry ?? null,
        });
        confidence = r.confidence;
        contactContext = `${r.context_md.trim()}\n\n_Problem: ${r.problem_statement ?? "—"} · confidence: ${r.confidence} · updated ${new Date().toISOString().slice(0, 10)}_`;
        if (!opts.dry) await hubspotRepo.updateContact(contact.id, { context: contactContext });
      }

      const draft = await draftEmail({
        first_name: contact.full_name?.split(/\s+/)[0] ?? null,
        full_name: contact.full_name, job_title: contact.job_title,
        company_name: company?.name ?? contact.company_name, industry: company?.industry ?? null,
        company_context: company?.context ?? null, contact_context: contactContext,
      }, cfg);

      const status = autoSendHigh && confidence === "high" ? "approved" : "queued";
      // company_* let the send batch spread sends across companies (≤1/company/day).
      const meta = { contact_name: contact.full_name, confidence, page_url: draft.page_url, page_title: draft.page_title, angle: draft.angle, company_id: contact.company_id ?? null, company_name: company?.name ?? contact.company_name ?? null };
      if (!opts.dry) await insertDraft(db, {
        hs_contact_id: contact.id, email: contact.email, campaign: opts.campaign,
        subject: draft.subject, body_text: draft.body, body_html: textToHtml(draft.body),
        status, owner_id: opts.ownerId ?? null, meta,
      });

      if (status === "approved") res.approved++; else res.queued++;
      res.processed++;
      log(`${contact.full_name ?? contact.email} → ${status} (${confidence})`);
      await new Promise((r) => setTimeout(r, 1200)); // pacing (SERP + Claude)
    } catch (e) {
      res.failed++;
      log(`✗ ${a.email}: ${(e as Error).message}`);
    }
  }

  return res;
}

// Insert, degrading gracefully if the meta column (migration 041) isn't applied.
export async function insertDraft(db: DB, row: Record<string, unknown>): Promise<void> {
  const r = await db.from("hs_sends").insert(row);
  if (r.error && /meta/.test(r.error.message)) {
    const { meta, ...base } = row;
    void meta;
    const r2 = await db.from("hs_sends").insert(base);
    if (r2.error) throw new Error(r2.error.message);
  } else if (r.error) {
    throw new Error(r.error.message);
  }
}
