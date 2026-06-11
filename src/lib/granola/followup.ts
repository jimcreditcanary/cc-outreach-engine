// Post-meeting follow-up email — outbound to the contact, distinct from
// the INTERNAL post-meeting summary (lib/meetings/postSummary.ts). This
// is the warm "thanks for your time, here's what we agreed, here's what
// I'll do next" mail that you'd otherwise type by hand at the end of a
// long day. AI drafts it from the Granola transcript + the existing
// meeting context (deal stage, MEDDICC gaps, prior brief).
//
// We deliberately keep it short — 3 short paragraphs / a short list of
// action items — to feel human, not auto-generated.

import { z } from "zod";
import { generateStructured } from "../ai/claude";
import { fmtDateTime } from "../format/datetime";

export const FollowupSchema = z.object({
  subject: z.string().min(3).max(120),
  body_text: z.string().min(40).max(2400),
  body_html: z.string().min(40).max(8000),
  /** AI's confidence (0-1) that the transcript was substantive enough to
   *  draft a follow-up. Below 0.4 we abort and don't ship — protects
   *  against firing on a 2-minute "let me reschedule" call. */
  confidence: z.number().min(0).max(1),
  /** One-liner: why it picked this angle (not shipped — for the log). */
  rationale: z.string().max(300),
});

export type Followup = z.infer<typeof FollowupSchema>;

export interface FollowupCtx {
  /** Recipient's first name for the salutation. */
  contact_first_name: string;
  /** Sender's name (the operator who owned the meeting). */
  sender_first_name: string;
  /** Sender's signature line (e.g. "Jim Fell — CEO, Credit Canary"). */
  sender_signoff: string;
  meeting_subject: string;
  meeting_started_at: string;
  org_name: string | null;
  deal_title: string | null;
  deal_stage: string | null;
  /** The pre-meeting brief, if Jim generated one. Helps the AI keep
   *  continuity ("you asked about X, here's the data you wanted"). */
  brief: string | null;
  /** The internal post-meeting summary we just generated from this
   *  transcript — gives the AI structured facts (decisions, actions,
   *  next steps) instead of forcing it to re-derive from raw transcript. */
  internal_summary: string;
  /** Raw transcript, trimmed by caller. Capped because Claude doesn't
   *  need the entire hour-long token dump if we already have a summary. */
  transcript_excerpt: string;
}

/** Generate the follow-up email from a meeting's Granola transcript. */
export async function generateFollowup(ctx: FollowupCtx): Promise<Followup> {
  const system = `You're drafting a post-meeting follow-up email on behalf of
${ctx.sender_first_name} at Credit Canary (UK credit-decisioning + payments
fintech). The recipient just had a meeting with ${ctx.sender_first_name} and is
expecting a "thanks, here's what we said, here's what I'll do next" note —
the kind you'd write yourself within an hour of the call.

This is NOT a sales pitch. The deal already exists. Tone is warm, direct,
no marketing register. Three short paragraphs MAX, or two paragraphs + a
short action-items list. ${ctx.contact_first_name} is busy — under 180 words.

HARD RULES:
- Start with a one-line thank-you that references ONE specific thing from the
  conversation (so it feels human, not templated).
- Then a short paragraph confirming what was agreed / decided.
- Then either a short paragraph of next steps OR a 3-bullet list of action
  items (who owns what, when). Use whichever is more natural.
- End with ONE clear next step — a date for the next touchpoint, a thing
  you'll send, or an explicit "I'll wait to hear from you on X".
- Sign off with the sender's signoff verbatim.
- NEVER invent commitments. If the transcript is vague, leave the next step
  open ("happy to pick this back up whenever works for you").
- NO emoji. NO "I hope this email finds you well". NO "Looking forward to
  unlocking value". NO "as discussed" twice in the same email.
- HTML body should mirror text body, just with <p> wrapping and <ul><li>
  for any bullet list. Subject line should NOT include "Re:" — Postmark
  threading handles that.

If the transcript is too thin to draft a meaningful follow-up (less than
~5 minutes of substantive content, mostly logistics, or the meeting was
rescheduled / interrupted), set confidence below 0.4 and return a stub
subject + a 1-line body explaining what was missing. The caller drops
the send when confidence < 0.4.

Return ONLY the JSON via the tool.`;

  const user = `MEETING
Subject: ${ctx.meeting_subject}
When: ${fmtDateTime(ctx.meeting_started_at)}
Company: ${ctx.org_name ?? "(unlinked)"}
${ctx.deal_title ? `Deal: "${ctx.deal_title}" (stage: ${ctx.deal_stage ?? "?"})` : "No deal linked."}

SENDER
${ctx.sender_first_name}
Signoff to use verbatim:
${ctx.sender_signoff}

RECIPIENT
${ctx.contact_first_name}

${ctx.brief ? `PRE-MEETING BRIEF (what ${ctx.sender_first_name} planned to ask):\n${ctx.brief}\n` : ""}
INTERNAL POST-MEETING SUMMARY (already generated, treat as source of truth):
${ctx.internal_summary}

TRANSCRIPT EXCERPT (raw — use for the human-feeling specific reference in line 1):
${ctx.transcript_excerpt}

Draft the follow-up email.`;

  return await generateStructured({
    system,
    user,
    schema: FollowupSchema,
    effort: "medium",
    maxTokens: 3000,
    cacheSystem: false,
  });
}
