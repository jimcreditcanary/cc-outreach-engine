// Pre-meeting AI brief. Pulls the meeting + linked contact/company/deal +
// MEDDICC gaps + recent notes + recent posts, and asks Claude for a tight
// pre-meeting prep: opener, target questions (esp. for the MEDDICC gap),
// risks/watch-outs, and the one thing to walk out with.

import { serviceClient } from "../db/client";
import { generateText } from "../ai/claude";
import { fmtDateTime } from "../format/datetime";

type DB = ReturnType<typeof serviceClient>;

export async function generateMeetingBrief(db: DB, meetingId: string): Promise<string | null> {
  const { data: meeting } = await db
    .from("meetings")
    .select(`
      subject, start_at, end_at, body_preview, attendees,
      contact:contacts(full_name, job_title, email),
      organisation:organisations(name, sector, tier, company_summary, recent_posts),
      deal:deals(title, status, stage, value, tcv, arr, proposal_exists,
        meddicc_metrics, meddicc_metrics_filled,
        meddicc_economic_buyer, meddicc_economic_buyer_filled,
        meddicc_decision_criteria, meddicc_decision_criteria_filled,
        meddicc_decision_process, meddicc_decision_process_filled,
        meddicc_identified_pain, meddicc_identified_pain_filled,
        meddicc_champion, meddicc_champion_filled,
        meddicc_competition, meddicc_competition_filled,
        next_best_action)
    `)
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return null;

  const c = meeting.contact as unknown as { full_name: string | null; job_title: string | null; email: string | null } | null;
  const o = meeting.organisation as unknown as {
    id?: string;
    name: string | null;
    sector: string | null;
    tier: number | null;
    company_summary: string | null;
    recent_posts: { title: string; published_at: string | null }[] | null;
  } | null;
  const d = meeting.deal as unknown as Record<string, unknown> | null;
  const attendees = (meeting.attendees ?? []) as { name: string | null; email: string | null }[];

  // Recent CRM notes for the org (last 5).
  let notes: string[] = [];
  if (o) {
    const { data: notesData } = await db
      .from("notes")
      .select("content")
      .eq("organisation_id", (meeting.organisation as { id?: string })?.id ?? "")
      .order("noted_at", { ascending: false })
      .limit(5);
    notes = (notesData ?? []).map((n) => String(n.content));
  }

  const meddiccBlock = d
    ? [
        ["Metrics", d.meddicc_metrics, d.meddicc_metrics_filled],
        ["Economic Buyer", d.meddicc_economic_buyer, d.meddicc_economic_buyer_filled],
        ["Decision Criteria", d.meddicc_decision_criteria, d.meddicc_decision_criteria_filled],
        ["Decision Process", d.meddicc_decision_process, d.meddicc_decision_process_filled],
        ["Identified Pain", d.meddicc_identified_pain, d.meddicc_identified_pain_filled],
        ["Champion", d.meddicc_champion, d.meddicc_champion_filled],
        ["Competition", d.meddicc_competition, d.meddicc_competition_filled],
      ]
        .map(([label, val, filled]) => `  - ${label} ${filled ? "[✓ filled]" : "[GAP]"}: ${val ?? "(empty)"}`)
        .join("\n")
    : "";

  const system = `You're a sales coach prepping Jim Fell (CEO, Credit Canary — UK credit-
decisioning + payments fintech) for an upcoming meeting. Output a tight,
plain-text brief (≤300 words) Jim can read in 60 seconds before the call.

Sections, in order:
- One-line context: who he's meeting + what state the deal is in
- Opener: a specific, non-salesy way to start (reference recent activity if any)
- Target questions: 3-5 questions, with the SINGLE biggest MEDDICC gap as the
  priority. Each question phrased the way a real founder asks, not a script.
- Watch-outs: 1-2 risks (objections, competition, decision-process traps)
- The one thing: what does Jim need to walk out with?

HARD RULES:
- Plain prose. No emojis. No '🎯' nonsense.
- NO marketing register. No 'leverage', 'unlock', 'value-add'.
- If MEDDICC has a clear biggest gap, anchor the brief on closing it.
- If no deal is linked, treat as a discovery meeting and ask the most useful
  discovery questions for the sector.`;

  const user = `MEETING
  Subject: ${meeting.subject ?? "(no subject)"}
  When: ${fmtDateTime(meeting.start_at)}
  Body preview: ${meeting.body_preview ?? "(none)"}
  Attendees: ${attendees.map((a) => `${a.name ?? a.email ?? "?"}`).filter(Boolean).join(", ") || "(unknown)"}

PRIMARY CONTACT
  Name: ${c?.full_name ?? "(unknown)"}
  Role: ${c?.job_title ?? "(unknown)"}
  Email: ${c?.email ?? "(unknown)"}

COMPANY: ${o?.name ?? "(unlinked)"} (sector: ${o?.sector ?? "?"} · tier: ${o?.tier ?? "?"})
${o?.company_summary ? `Summary: ${o.company_summary}` : ""}
${o?.recent_posts && o.recent_posts.length ? `Recent posts:\n${o.recent_posts.slice(0, 3).map((p) => `  - "${p.title}"`).join("\n")}` : ""}

${d ? `DEAL: "${d.title}" (status: ${d.status}, stage: ${d.stage ?? "?"})
  TCV: ${d.tcv ?? d.value ?? "?"} · ARR: ${d.arr ?? "?"}
  Proposal attached: ${d.proposal_exists ? "yes" : "no"}

MEDDICC:
${meddiccBlock}

${d.next_best_action ? `Current next-best-action:\n${d.next_best_action}` : ""}` : "DEAL: none linked — treat as discovery."}

RECENT CRM NOTES (most recent first):
${notes.length ? notes.map((n, i) => `  ${i + 1}. ${n}`).join("\n") : "  (none)"}

Now produce the brief.`;

  const brief = await generateText({
    system,
    user,
    effort: "medium",
    maxTokens: 1500,
    cacheSystem: false,
  });

  await db
    .from("meetings")
    .update({ brief, brief_generated_at: new Date().toISOString() })
    .eq("id", meetingId);
  return brief;
}
