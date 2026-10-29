// Hot "work this deal" flow. Two Claude steps, one per operator action:
//   1. assessDealForWork — pull the deal's context (fields + recent notes +
//      contact/company) and appraise it (MEDDICC): where it stands, the biggest
//      gap, the next best action, and 3–5 MEDDICC-style questions to answer
//      before writing a re-engagement email.
//   2. draftFromAnswers — take the operator's answers + the context and draft
//      the email, which then goes into the workflow review queue (hs_sends).
//
// Shares the anonymisation guard + draft config with the batch nurture path.

import { z } from "zod";
import { generateStructured } from "../ai/claude";
import { checkAnonymisation } from "../generate/anonymisation";
import { DEFAULT_DRAFT_CONFIG, type DraftConfig } from "./draft";
import type { DealRecord, CompanyRecord, ContactRecord } from "../crm/types";

export interface DealNote { ts: string | null; body: string }

export interface DealContext {
  deal: DealRecord;
  company: CompanyRecord | null;
  contact: ContactRecord | null;
  notes: DealNote[];
}

function contextBlock(ctx: DealContext): string {
  const { deal, company, contact, notes } = ctx;
  const recent = notes.length
    ? notes.slice(0, 5).map((n) => `- [${n.ts ?? "?"}] ${n.body}`).join("\n")
    : "(no recent notes logged on the deal)";
  return [
    `Deal: ${deal.name ?? "(unnamed)"} — ${deal.pipeline ?? ""} › ${deal.stage ?? ""}`,
    `Amount: ${deal.amount ?? "?"} ${deal.currency ?? ""} · Close: ${deal.close_date ?? "?"}`,
    `Next step (HubSpot): ${deal.next_step ?? "—"}`,
    `Last contacted: ${deal.last_contacted ?? "—"} · Last activity: ${deal.last_activity ?? "—"} · Next meeting: ${deal.next_meeting_at ?? "—"}`,
    `Company: ${company?.name ?? "?"} (${company?.industry ?? "?"})`,
    `Company context: ${company?.context?.trim() || "(none)"}`,
    `Primary contact: ${contact?.full_name ?? "?"} — ${contact?.job_title ?? "?"}`,
    `Contact context: ${contact?.context?.trim() || "(none)"}`,
    ``,
    `Recent activity / notes (newest first):`,
    recent,
  ].join("\n");
}

const assessSchema = z.object({
  summary: z.string().describe("2–4 sentences: where the deal stands right now, reflecting the most recent activity/notes."),
  biggest_gap: z.string().describe("The single biggest gap or risk to closing."),
  next_best_action: z.string().describe("The one concrete next step to progress it."),
  questions: z
    .array(
      z.object({
        id: z.string().describe("short stable slug, e.g. economic_buyer, timeline, pricing"),
        question: z.string().describe("a specific MEDDICC-style question to answer before writing the email"),
      }),
    )
    .describe("3–5 targeted questions, focused on the gaps, whose answers would most improve the re-engagement email. Only ask about things the context doesn't already answer."),
});
export type DealAssessment = z.infer<typeof assessSchema>;

const ASSESS_SYSTEM = `You are a sales coach for Credit Canary (UK credit decisioning / affordability / origination for lenders). Read the deal context and recent activity, then appraise the deal with MEDDICC. Return: a short read on where it stands (reflecting the latest activity), the single biggest gap to closing, the one concrete next best action, and 3–5 specific MEDDICC-style questions the rep should answer before writing a re-engagement email. Ask only about things the context does not already answer. Never invent facts.`;

export async function assessDealForWork(ctx: DealContext): Promise<DealAssessment> {
  return generateStructured({ system: ASSESS_SYSTEM, user: contextBlock(ctx), schema: assessSchema, effort: "medium", maxTokens: 1400 });
}

const draftSchema = z.object({ subject: z.string(), body: z.string() });
export interface WorkedDraft { subject: string; body: string }

function draftSystem(cfg: DraftConfig): string {
  return `You are ${cfg.senderName} at Credit Canary, progressing an ACTIVE deal with a prospect you're already in conversation with. Using the deal context and the rep's own answers below, write a short, warm, specific email that moves the deal forward with ONE clear next-step CTA.

VOICE
${cfg.toneNotes}

RULES
- This is a live deal, not cold outreach — pick up where things are, no generic pitch, no re-introduction.
- Ground the email in the rep's answers; don't contradict them or invent facts beyond the context.
- One clear, easy CTA. Really short. No "just checking in / circling back" clichés.
- NEVER name another Credit Canary client; anonymise to descriptors.
- Sign off exactly: "${cfg.signOff}".`;
}

export async function draftFromAnswers(args: {
  ctx: DealContext;
  assessment: Pick<DealAssessment, "summary" | "biggest_gap" | "next_best_action">;
  qa: { question: string; answer: string }[];
  config?: DraftConfig;
}): Promise<WorkedDraft> {
  const cfg = args.config ?? DEFAULT_DRAFT_CONFIG;
  const answered = args.qa.filter((x) => x.answer.trim());
  const qaBlock = answered.length
    ? answered.map((x) => `Q: ${x.question}\nA: ${x.answer.trim()}`).join("\n\n")
    : "(the rep left the questions blank — work from the context only)";
  const user = [
    contextBlock(args.ctx),
    ``,
    `Where it stands: ${args.assessment.summary}`,
    `Biggest gap: ${args.assessment.biggest_gap}`,
    `Next best action (base the CTA on this unless the answers point elsewhere): ${args.assessment.next_best_action}`,
    ``,
    `The rep's answers:`,
    qaBlock,
    ``,
    `Write the email now.`,
  ].join("\n");

  let out = await generateStructured({ system: draftSystem(cfg), user, schema: draftSchema, effort: "high", maxTokens: 1200 });
  let check = checkAnonymisation(`${out.subject}\n${out.body}`);
  if (!check.clean) {
    out = await generateStructured({
      system: draftSystem(cfg),
      user: `${user}\n\nPrevious attempt named a client (${check.hits.join(", ")}). Rewrite without naming any client.`,
      schema: draftSchema,
      effort: "high",
      maxTokens: 1200,
    });
    check = checkAnonymisation(`${out.subject}\n${out.body}`);
    if (!check.clean) throw new Error(`Anonymisation leak: ${check.hits.join(", ")}`);
  }
  return out;
}
