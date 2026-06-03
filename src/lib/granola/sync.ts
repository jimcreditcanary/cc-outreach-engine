// Granola sync engine. Once per cron tick, for every operator who has a
// granola_api_token:
//
//   1. listNotes() against Granola
//   2. For each note, try to match it to a meetings row owned by the
//      operator (start_at within ±15 min + at least one attendee email
//      in common — falls back to start_at-only when attendees missing).
//   3. If matched + transcript still empty on our side + Granola has one:
//      a) pull the full note WITH transcript
//      b) write transcript + granola_note_id + granola_synced_at
//      c) run generatePostMeetingSummary (existing — fills post_summary)
//      d) call generateFollowup → insert as sends row (status='sent' if
//         POSTMARK_SERVER_TOKEN present, else 'approved' = dry-run path)
//         and actually ship via sendBroadcast.
//      e) log the send id back onto meetings.granola_followup_send_id.
//   4. Skip cleanly if already synced, transcript empty (try next tick),
//      or no contact email to send to.
//
// Idempotent: granola_note_id has a unique index so a duplicate run can't
// double-create transcripts; the followup-send check uses
// granola_followup_send_id null-check so a re-run won't double-send.

import type { SupabaseClient } from "@supabase/supabase-js";
import { listNotes, getNoteWithTranscript, type GranolaNote } from "./client";
import { generateFollowup } from "./followup";
import { generatePostMeetingSummary } from "../meetings/postSummary";
import { sendBroadcast } from "../send/postmark";
import { displayName } from "../auth/owner";

export interface SyncResult {
  operators_checked: number;
  notes_seen: number;
  meetings_matched: number;
  transcripts_pulled: number;
  followups_sent: number;
  followups_skipped_low_confidence: number;
  errors: string[];
}

/** Tolerance for matching Granola's meeting start time to our meetings
 *  table — calendar systems disagree by a few minutes sometimes. */
const MATCH_WINDOW_MS = 15 * 60 * 1000;

interface MeetingRow {
  id: string;
  subject: string | null;
  start_at: string;
  attendees: Array<{ email?: string | null }> | null;
  transcript: string | null;
  granola_note_id: string | null;
  granola_followup_send_id: string | null;
  brief: string | null;
  owner_id: string | null;
  organisation_id: string | null;
  deal_id: string | null;
  organisation: { name: string | null } | { name: string | null }[] | null;
  primary_contact: { id: string; full_name: string | null; email: string | null } | { id: string; full_name: string | null; email: string | null }[] | null;
  deal: { title: string | null; stage: string | null } | { title: string | null; stage: string | null }[] | null;
}
const pick = <T>(v: T | T[] | null): T | null => v ? (Array.isArray(v) ? (v[0] ?? null) : v) : null;
const firstName = (full: string | null | undefined): string => (full ?? "there").trim().split(/\s+/)[0] || "there";

export async function syncGranolaForUser(
  db: SupabaseClient,
  userId: string,
  apiToken: string,
  result: SyncResult,
): Promise<void> {
  // Pull notes from Granola first — cheap and tells us which meetings to
  // even bother looking up.
  let notes: GranolaNote[] = [];
  try {
    // Window: last 7 days. Granola will return processing-still-pending
    // ones too; we re-poll them next tick when transcript fills.
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    notes = await listNotes(apiToken, { sinceISO: since });
  } catch (e) {
    result.errors.push(`listNotes(${userId}): ${(e as Error).message}`);
    return;
  }
  result.notes_seen += notes.length;
  if (notes.length === 0) return;

  // Pull this operator's recent meetings ONCE so we can match in memory.
  const earliestNote = notes
    .map((n) => (n.started_at ? new Date(n.started_at).getTime() : Infinity))
    .reduce((a, b) => Math.min(a, b), Infinity);
  const windowStart = isFinite(earliestNote)
    ? new Date(earliestNote - MATCH_WINDOW_MS).toISOString()
    : new Date(Date.now() - 14 * 86_400_000).toISOString();

  const { data: meetingsData, error: mErr } = await db
    .from("meetings")
    .select(`
      id, subject, start_at, attendees, transcript, granola_note_id,
      granola_followup_send_id, brief, owner_id, organisation_id, deal_id,
      organisation:organisations(name),
      primary_contact:contacts(id, full_name, email),
      deal:deals(title, stage)
    `)
    .eq("owner_id", userId)
    .gte("start_at", windowStart)
    .lte("start_at", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
    .limit(500);
  if (mErr) {
    result.errors.push(`meetings(${userId}): ${mErr.message}`);
    return;
  }
  const meetings = (meetingsData ?? []) as unknown as MeetingRow[];
  if (meetings.length === 0) return;

  for (const note of notes) {
    if (!note.started_at) continue;
    const noteTs = new Date(note.started_at).getTime();
    if (!isFinite(noteTs)) continue;

    // First pass: match by start-time window + attendee email overlap.
    // Fallback: start-time window only (when attendees not surfaced).
    const candidates = meetings.filter(
      (m) => Math.abs(new Date(m.start_at).getTime() - noteTs) <= MATCH_WINDOW_MS,
    );
    if (candidates.length === 0) continue;

    let matched: MeetingRow | undefined;
    if (note.attendee_emails.length > 0) {
      const noteEmails = new Set(note.attendee_emails);
      matched = candidates.find((m) => {
        const ours = (m.attendees ?? []).map((a) => (a?.email ?? "").trim().toLowerCase()).filter(Boolean);
        return ours.some((e) => noteEmails.has(e));
      });
    }
    if (!matched) {
      // Closest start-time wins when no email overlap.
      matched = candidates.sort(
        (a, b) =>
          Math.abs(new Date(a.start_at).getTime() - noteTs) -
          Math.abs(new Date(b.start_at).getTime() - noteTs),
      )[0];
    }
    if (!matched) continue;
    result.meetings_matched++;

    // Skip if we've already pulled this note's transcript onto this row.
    const alreadySynced =
      !!matched.transcript && !!matched.granola_note_id && matched.granola_note_id === note.id;
    if (alreadySynced && matched.granola_followup_send_id) continue;

    // Pull the full transcript (Granola requires a second call for it).
    let full: GranolaNote;
    try {
      full = await getNoteWithTranscript(apiToken, note.id);
    } catch (e) {
      result.errors.push(`getNote(${note.id}): ${(e as Error).message}`);
      continue;
    }
    if (!full.transcript || full.transcript.trim().length < 200) {
      // Still processing on Granola side — try next tick.
      continue;
    }

    // Write transcript + meta if we haven't already.
    if (!alreadySynced) {
      const { error: updErr } = await db
        .from("meetings")
        .update({
          transcript: full.transcript,
          granola_note_id: full.id,
          granola_synced_at: new Date().toISOString(),
        })
        .eq("id", matched.id);
      if (updErr) {
        result.errors.push(`update transcript(${matched.id}): ${updErr.message}`);
        continue;
      }
      result.transcripts_pulled++;

      // Fire the internal post-meeting summary — fills post_summary +
      // updates MEDDICC if there's a linked deal. Errors here don't block
      // the follow-up; we just log them.
      try {
        await generatePostMeetingSummary(db, matched.id);
      } catch (e) {
        result.errors.push(`postSummary(${matched.id}): ${(e as Error).message}`);
      }
    }

    // ---- Outbound follow-up email ----
    if (matched.granola_followup_send_id) continue; // already sent
    const contact = pick(matched.primary_contact);
    if (!contact?.email) continue; // nobody to email
    const org = pick(matched.organisation);
    const deal = pick(matched.deal);

    // Re-read the meeting to pick up the just-generated post_summary.
    const { data: refreshed } = await db
      .from("meetings")
      .select("post_summary")
      .eq("id", matched.id)
      .maybeSingle();
    const internalSummary =
      (refreshed?.post_summary as string | null) ?? full.granola_summary ?? "";
    if (!internalSummary) continue;

    // Sender identity → from user_settings (display name + signoff line).
    const { data: settings } = await db
      .from("user_settings")
      .select("first_name, last_name, job_title, reply_to_email, from_email")
      .eq("user_id", userId)
      .maybeSingle();
    const senderFirst = (settings?.first_name as string | null) ?? "Jim";
    const senderName = displayName({
      id: userId,
      first_name: (settings?.first_name as string | null) ?? null,
      last_name: (settings?.last_name as string | null) ?? null,
      email: null,
    });
    const senderSignoff =
      `${senderName}${(settings?.job_title as string | null) ? ` — ${settings?.job_title}` : ""}, Credit Canary`;

    let draft;
    try {
      draft = await generateFollowup({
        contact_first_name: firstName(contact.full_name),
        sender_first_name: senderFirst,
        sender_signoff: senderSignoff,
        meeting_subject: matched.subject ?? "our meeting",
        meeting_started_at: matched.start_at,
        org_name: org?.name ?? null,
        deal_title: deal?.title ?? null,
        deal_stage: deal?.stage ?? null,
        brief: matched.brief ?? null,
        internal_summary: internalSummary,
        transcript_excerpt: full.transcript.slice(0, 6000),
      });
    } catch (e) {
      result.errors.push(`draft followup(${matched.id}): ${(e as Error).message}`);
      continue;
    }
    if (draft.confidence < 0.4) {
      result.followups_skipped_low_confidence++;
      continue;
    }

    // Ship it. Insert the sends row first so we have an id; then send;
    // then mark it sent + link from the meeting.
    const { data: inserted, error: insErr } = await db
      .from("sends")
      .insert({
        contact_id: contact.id,
        subject: draft.subject,
        body_html: draft.body_html,
        body_text: draft.body_text,
        original_body_text: draft.body_text,
        status: "approved",
        owner_id: userId,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      result.errors.push(`sends insert(${matched.id}): ${insErr?.message ?? "no row"}`);
      continue;
    }

    try {
      const sendRes = await sendBroadcast({
        to: contact.email,
        subject: draft.subject,
        htmlBody: draft.body_html,
        textBody: draft.body_text,
        tag: "granola-followup",
        ownerId: userId,
        trackOpens: false,
      });
      await db
        .from("sends")
        .update({ status: "sent", ts: new Date().toISOString(), postmark_message_id: sendRes.messageId })
        .eq("id", inserted.id);
      await db.from("meetings").update({ granola_followup_send_id: inserted.id }).eq("id", matched.id);
      // Timeline event so the contact page shows the touch.
      await db.from("events").insert({
        contact_id: contact.id,
        organisation_id: matched.organisation_id,
        type: "outbound_email",
        source: "granola-followup",
        payload: {
          subject: draft.subject,
          meeting_id: matched.id,
          send_id: inserted.id,
          rationale: draft.rationale,
        },
      });
      result.followups_sent++;
    } catch (e) {
      await db.from("sends").update({ status: "failed" }).eq("id", inserted.id);
      result.errors.push(`send(${matched.id}): ${(e as Error).message}`);
    }
  }
}

/** Cron entry — runs syncGranolaForUser for every operator with a token. */
export async function syncAllGranola(db: SupabaseClient): Promise<SyncResult> {
  const result: SyncResult = {
    operators_checked: 0,
    notes_seen: 0,
    meetings_matched: 0,
    transcripts_pulled: 0,
    followups_sent: 0,
    followups_skipped_low_confidence: 0,
    errors: [],
  };
  const { data: rows, error } = await db
    .from("user_settings")
    .select("user_id, granola_api_token")
    .not("granola_api_token", "is", null);
  if (error) {
    result.errors.push(`load tokens: ${error.message}`);
    return result;
  }
  for (const r of (rows ?? []) as { user_id: string; granola_api_token: string }[]) {
    if (!r.granola_api_token) continue;
    result.operators_checked++;
    try {
      await syncGranolaForUser(db, r.user_id, r.granola_api_token, result);
    } catch (e) {
      result.errors.push(`syncGranolaForUser(${r.user_id}): ${(e as Error).message}`);
    }
  }
  return result;
}
