// Weekly deal-nurture workflow (2nd campaign type). For each open deal the rep
// owns: appraise it via MEDDICC, then draft a short, specific nudge to the
// deal's contact with one clear next-step CTA. Deals already in live comms this
// week are skipped. Drafts land in the same review queue (hs_sends) and send via
// the same guarded runner.

import { z } from "zod";
import type { serviceClient } from "../db/client";
import { generateStructured } from "../ai/claude";
import { checkAnonymisation } from "../generate/anonymisation";
import { hubspotRepo, listOwnerOpenDeals, dealContactIds } from "../hubspot/repo";
import { DEFAULT_DRAFT_CONFIG, type DraftConfig } from "./draft";
import { textToHtml } from "./render";
import { insertDraft } from "./workflow";
import type { DealRecord, CompanyRecord, ContactRecord } from "../crm/types";

const meddiccSchema = z.object({
  metrics: z.string().nullable(),
  economic_buyer: z.string().nullable(),
  decision_criteria: z.string().nullable(),
  decision_process: z.string().nullable(),
  identified_pain: z.string().nullable(),
  champion: z.string().nullable(),
  competition: z.string().nullable(),
  summary: z.string().describe("2–3 sentence read on where the deal stands."),
  biggest_gap: z.string().describe("The single biggest gap/risk to closing."),
  next_best_action: z.string().describe("The one concrete next step to move it forward."),
  confidence: z.enum(["high", "medium", "low"]),
});
export type MeddiccAppraisal = z.infer<typeof meddiccSchema>;

const APPRAISE_SYSTEM = `You are a sales coach appraising an active B2B deal for Credit Canary (UK credit decisioning/origination for lenders) using MEDDICC. From the deal facts provided, fill each MEDDICC element from real signal only — use null where there's genuinely no evidence (do NOT invent). Then give a short summary, the single biggest gap to closing, and the one concrete next best action to progress it.`;

export async function appraiseDeal(args: {
  deal: DealRecord; company: CompanyRecord | null; contact: ContactRecord | null;
}): Promise<MeddiccAppraisal> {
  const { deal, company, contact } = args;
  const user = [
    `Deal: ${deal.name ?? "(unnamed)"} — ${deal.pipeline ?? ""} › ${deal.stage ?? ""}`,
    `Amount: ${deal.amount ?? "?"} ${deal.currency ?? ""} · Close: ${deal.close_date ?? "?"}`,
    `Next step (HubSpot): ${deal.next_step ?? "—"}`,
    `Last contacted: ${deal.last_contacted ?? "—"} · Next meeting: ${deal.next_meeting_at ?? "—"}`,
    `Company: ${company?.name ?? "?"} (${company?.industry ?? "?"})`,
    `Company context: ${company?.context?.trim() || "(none)"}`,
    `Primary contact: ${contact?.full_name ?? "?"} — ${contact?.job_title ?? "?"}`,
    `Contact context: ${contact?.context?.trim() || "(none)"}`,
  ].join("\n");
  return generateStructured({ system: APPRAISE_SYSTEM, user, schema: meddiccSchema, effort: "medium", maxTokens: 1200 });
}

const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});
export interface NurtureDraft { subject: string; body: string }

function nurtureSystem(cfg: DraftConfig): string {
  return `You are ${cfg.senderName} at Credit Canary, progressing an ACTIVE deal with a prospect you're already in conversation with. Write a short, warm, specific email that moves the deal forward with ONE clear next-step CTA (based on the recommended next best action).

VOICE
${cfg.toneNotes}

RULES
- This is a live deal, not cold outreach — no "introducing ourselves", no generic pitch. Pick up where things are.
- One clear, easy CTA (the next best action) — a specific ask that prompts the client to act (e.g. confirm a step, review something, get a date in).
- Really short. No fluff, no pressure, no "just checking in / circling back" clichés.
- NEVER name another Credit Canary client; anonymise to descriptors. NEVER invent facts.
- Sign off exactly: "${cfg.signOff}".`;
}

export async function draftNurture(args: {
  deal: DealRecord; appraisal: MeddiccAppraisal; contact: ContactRecord; company: CompanyRecord | null; config?: DraftConfig;
}): Promise<NurtureDraft> {
  const cfg = args.config ?? DEFAULT_DRAFT_CONFIG;
  const user = [
    `Contact: ${args.contact.full_name ?? "?"} — ${args.contact.job_title ?? "?"} at ${args.company?.name ?? "?"}`,
    `Deal stage: ${args.deal.stage ?? "?"}`,
    `Where it stands: ${args.appraisal.summary}`,
    `Biggest gap: ${args.appraisal.biggest_gap}`,
    `Next best action (base the CTA on this): ${args.appraisal.next_best_action}`,
    "",
    "Write the nurture email now.",
  ].join("\n");
  let out = await generateStructured({ system: nurtureSystem(cfg), user, schema: draftSchema, effort: "high", maxTokens: 1200 });
  let check = checkAnonymisation(`${out.subject}\n${out.body}`);
  if (!check.clean) {
    out = await generateStructured({ system: nurtureSystem(cfg), user: `${user}\n\nPrevious attempt named a client (${check.hits.join(", ")}). Rewrite without naming any client.`, schema: draftSchema, effort: "high", maxTokens: 1200 });
    check = checkAnonymisation(`${out.subject}\n${out.body}`);
    if (!check.clean) throw new Error(`Anonymisation leak: ${check.hits.join(", ")}`);
  }
  return out;
}

type DB = ReturnType<typeof serviceClient>;

export interface NurtureOpts {
  ownerHubspotId: string;
  ownerId?: string | null;   // supabase operator
  limit?: number;
  cooldownDays?: number;     // skip deals contacted within this window (default 7)
  campaign?: string;
  config?: DraftConfig;
  dry?: boolean;
  onProgress?: (msg: string) => void;
}

export interface NurtureResult {
  deals: number; processed: number; queued: number; skippedRecent: number; skippedNoContact: number; failed: number;
}

export async function runDealNurture(db: DB, opts: NurtureOpts): Promise<NurtureResult> {
  const cfg = opts.config ?? DEFAULT_DRAFT_CONFIG;
  const cooldownDays = opts.cooldownDays ?? 7;
  const limit = opts.limit ?? 25;
  const campaign = opts.campaign ?? `deal-nurture-${new Date().toISOString().slice(0, 10)}`;
  const log = opts.onProgress ?? (() => {});

  const deals = await listOwnerOpenDeals(opts.ownerHubspotId, Math.max(limit * 2, 50));
  const cutoff = Date.now() - cooldownDays * 86_400_000;

  const { data: active } = await db.from("hs_sends").select("hs_contact_id").in("status", ["queued", "approved"]);
  const activeContacts = new Set((active ?? []).map((r) => String((r as { hs_contact_id: string }).hs_contact_id)));

  const res: NurtureResult = { deals: deals.length, processed: 0, queued: 0, skippedRecent: 0, skippedNoContact: 0, failed: 0 };

  for (const deal of deals) {
    if (res.processed >= limit) break;
    // Already in comms this week → let the rep "pass" automatically.
    if (deal.last_contacted && new Date(deal.last_contacted).getTime() > cutoff) { res.skippedRecent++; continue; }
    try {
      const ids = await dealContactIds(deal.id);
      const contact = ids[0] ? await hubspotRepo.getContact(ids[0]) : null;
      if (!contact?.email || contact.email_bounced) { res.skippedNoContact++; continue; }
      if (activeContacts.has(contact.id)) { res.skippedRecent++; continue; }
      const company = contact.company_id ? await hubspotRepo.getCompany(contact.company_id) : null;

      const appraisal = await appraiseDeal({ deal, company, contact });
      if (!opts.dry) {
        await db.from("deal_appraisals").insert({
          hs_deal_id: deal.id, owner_id: opts.ownerId ?? null,
          meddicc: { metrics: appraisal.metrics, economic_buyer: appraisal.economic_buyer, decision_criteria: appraisal.decision_criteria, decision_process: appraisal.decision_process, identified_pain: appraisal.identified_pain, champion: appraisal.champion, competition: appraisal.competition },
          summary: appraisal.summary, biggest_gap: appraisal.biggest_gap, next_best_action: appraisal.next_best_action,
        }).then(({ error }) => error && log(`appraisal store: ${error.message}`));
      }

      const draft = await draftNurture({ deal, appraisal, contact, company, config: cfg });
      if (!opts.dry) await insertDraft(db, {
        hs_contact_id: contact.id, email: contact.email, campaign,
        subject: draft.subject, body_text: draft.body, body_html: textToHtml(draft.body),
        status: "queued", owner_id: opts.ownerId ?? null,
        meta: { contact_name: contact.full_name, confidence: appraisal.confidence, kind: "deal-nurture", deal_id: deal.id, deal_name: deal.name, stage: deal.stage, angle: appraisal.next_best_action },
      });

      res.queued++; res.processed++;
      log(`${deal.name ?? deal.id} → ${contact.full_name ?? contact.email} (${appraisal.confidence})`);
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      res.failed++;
      log(`✗ ${deal.name ?? deal.id}: ${(e as Error).message}`);
    }
  }
  return res;
}
