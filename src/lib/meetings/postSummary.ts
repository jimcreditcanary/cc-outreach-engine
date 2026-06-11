// Post-meeting AI: takes a pasted transcript (or rough notes), produces a
// crisp post-meeting summary (decisions, action items, MEDDICC signals)
// and writes it back to meetings.post_summary. If the meeting has a linked
// deal, the transcript gets folded into the deal's notes and MEDDICC is
// re-seeded so the new context updates the qualification layer.
//
// Designed for paste-transcript today; the same entry point will accept
// Whisper output later (transcript already lives on meetings.transcript).

import { serviceClient } from "../db/client";
import { generateText } from "../ai/claude";
import { seedDealMeddicc } from "../meddicc/seedDeal";
import { fmtDateTime } from "../format/datetime";

type DB = ReturnType<typeof serviceClient>;

export interface PostSummaryResult {
  summary: string;
  meddicc_re_seeded: boolean;
  meddicc_biggest_gap: string | null;
}

/** Generate (or regenerate) the post-meeting summary for a meeting. The
 *  meeting must have either a transcript or notes — otherwise nothing to
 *  summarise. Returns the new summary text + whether MEDDICC was re-seeded. */
export async function generatePostMeetingSummary(
  db: DB,
  meetingId: string,
): Promise<PostSummaryResult | null> {
  const { data: meeting } = await db
    .from("meetings")
    .select(`
      id, subject, start_at, transcript, notes, brief, organisation_id, deal_id,
      organisation:organisations(name, sector),
      primary_contact:contacts(full_name, job_title),
      deal:deals(title, status, stage)
    `)
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return null;
  const transcript = String(meeting.transcript ?? "").trim();
  const notes = String(meeting.notes ?? "").trim();
  if (!transcript && !notes) return null;

  const c = meeting.primary_contact as unknown as { full_name: string | null; job_title: string | null } | null;
  const o = meeting.organisation as unknown as { name: string | null; sector: string | null } | null;
  const d = meeting.deal as unknown as { title: string | null; status: string | null; stage: string | null } | null;

  const system = `You're a sales coach summarising a just-completed meeting for Jim
Fell (CEO, Credit Canary — UK credit-decisioning + payments fintech).
Output a tight plain-text post-meeting summary (≤350 words) Jim can
paste into the CRM and forward to his team.

Sections, in order:
- One-line outcome (e.g. "Moving to commercial discussion next week.")
- Key decisions / agreements
- Action items (bullet list — who owns what, by when if mentioned)
- MEDDICC signals — what landed on each of Metrics / Economic Buyer /
  Decision Criteria / Decision Process / Identified Pain / Champion /
  Competition. Skip any that didn't come up.
- Risks / watch-outs surfaced
- Recommended next step

HARD RULES:
- Plain prose. No emojis, no headers shouted in caps.
- NO marketing register. No "leverage", "unlock", "value-add".
- Be concrete — names, numbers, dates as said in the transcript.
- If the transcript is sparse, say so explicitly; do not invent commitments.`;

  const user = `MEETING
  Subject: ${meeting.subject ?? "(no subject)"}
  When: ${fmtDateTime(meeting.start_at as string)}
  Company: ${o?.name ?? "(unlinked)"} (sector: ${o?.sector ?? "?"})
  Primary contact: ${c?.full_name ?? "(unknown)"}${c?.job_title ? `, ${c.job_title}` : ""}
  ${d ? `Linked deal: "${d.title}" (status: ${d.status}, stage: ${d.stage ?? "?"})` : "No deal linked."}

${meeting.brief ? `PRE-MEETING BRIEF (for context — questions you intended to ask):\n${meeting.brief}\n` : ""}
${transcript ? `TRANSCRIPT (what was actually said):\n${transcript}` : `NOTES (rough, not a transcript):\n${notes}`}

Now produce the post-meeting summary.`;

  const summary = await generateText({
    system,
    user,
    effort: "medium",
    maxTokens: 2000,
    cacheSystem: false,
  });

  await db
    .from("meetings")
    .update({ post_summary: summary, post_summary_generated_at: new Date().toISOString() })
    .eq("id", meetingId);

  // If there's a linked deal, fold the summary into the org's notes and
  // re-seed MEDDICC so the new context flows into qualification.
  let meddicc_biggest_gap: string | null = null;
  let meddicc_re_seeded = false;
  if (meeting.deal_id && meeting.organisation_id) {
    try {
      await db.from("notes").insert({
        organisation_id: meeting.organisation_id,
        content: `[meeting summary: ${meeting.subject ?? meetingId}]\n${summary}`,
        author: "AI (post-meeting)",
        noted_at: new Date().toISOString(),
      });
      meddicc_biggest_gap = await seedDealMeddicc(db, meeting.deal_id as string);
      meddicc_re_seeded = true;
    } catch (e) {
      console.error("post-meeting MEDDICC re-seed failed", e);
    }
  }

  return { summary, meddicc_re_seeded, meddicc_biggest_gap };
}
