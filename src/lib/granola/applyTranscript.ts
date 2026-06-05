// Shared post-transcript pipeline: takes a transcript (from anywhere —
// Granola API, Granola share-email, manual paste) and a meeting row,
// then:
//
//   1. Writes meetings.transcript + granola_synced_at + (optional)
//      granola_note_id.
//   2. Runs generatePostMeetingSummary (fills post_summary + re-seeds
//      MEDDICC if there's a linked deal).
//   3. Generates an outbound follow-up email via generateFollowup and
//      inserts it as a QUEUED draft in /queue for operator review.
//      It does NOT auto-send — first-touch-after-meeting emails go
//      through Jim's eyes before they ship.
//   4. Pins the queued send id onto meetings.granola_followup_send_id
//      so re-runs don't re-draft.
//
// Idempotent on re-runs:
//   - Transcript only written when meetings.transcript is empty.
//   - Draft only created when granola_followup_send_id is null.
//
// Returns a result struct the caller can log + flash.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePostMeetingSummary } from "../meetings/postSummary";
import { generateFollowup } from "./followup";
import { displayName } from "../auth/owner";

export interface ApplyResult {
  transcript_written: boolean;
  post_summary_ran: boolean;
  followup_sent: boolean;
  followup_skipped_reason: string | null;
  errors: string[];
}

const firstName = (full: string | null | undefined): string =>
  (full ?? "there").trim().split(/\s+/)[0] || "there";

interface MeetingForApply {
  id: string;
  subject: string | null;
  start_at: string;
  transcript: string | null;
  brief: string | null;
  owner_id: string | null;
  organisation_id: string | null;
  granola_followup_send_id: string | null;
  organisation: { name: string | null } | { name: string | null }[] | null;
  primary_contact: { id: string; full_name: string | null; email: string | null } | { id: string; full_name: string | null; email: string | null }[] | null;
  deal: { title: string | null; stage: string | null } | { title: string | null; stage: string | null }[] | null;
}
const pick = <T>(v: T | T[] | null): T | null => v ? (Array.isArray(v) ? (v[0] ?? null) : v) : null;

export async function applyTranscriptToMeeting(
  db: SupabaseClient,
  meeting: MeetingForApply,
  payload: {
    transcript: string;
    granolaSummary: string | null;
    granolaNoteId?: string | null;
    /** Source label, stored on the timeline event. e.g. "granola-email". */
    source: string;
  },
): Promise<ApplyResult> {
  const result: ApplyResult = {
    transcript_written: false,
    post_summary_ran: false,
    followup_sent: false,
    followup_skipped_reason: null,
    errors: [],
  };

  // ── 1. Write transcript (skip if one already exists) ─────────────
  if (!meeting.transcript) {
    const patch: Record<string, unknown> = {
      transcript: payload.transcript,
      granola_synced_at: new Date().toISOString(),
    };
    if (payload.granolaNoteId) patch.granola_note_id = payload.granolaNoteId;
    const { error: updErr } = await db.from("meetings").update(patch).eq("id", meeting.id);
    if (updErr) {
      result.errors.push(`write transcript: ${updErr.message}`);
      return result;
    }
    result.transcript_written = true;
  }

  // ── 2. Post-meeting summary (best-effort) ────────────────────────
  try {
    await generatePostMeetingSummary(db, meeting.id);
    result.post_summary_ran = true;
  } catch (e) {
    result.errors.push(`post-summary: ${(e as Error).message}`);
  }

  // ── 3. Follow-up email ───────────────────────────────────────────
  if (meeting.granola_followup_send_id) {
    result.followup_skipped_reason = "follow-up already sent on a previous run";
    return result;
  }
  const contact = pick(meeting.primary_contact);
  if (!contact?.email) {
    result.followup_skipped_reason = "no primary contact email on the meeting";
    return result;
  }
  if (!meeting.owner_id) {
    result.followup_skipped_reason = "meeting has no owner_id — can't pick a sender identity";
    return result;
  }

  // Re-read to pick up the just-written post_summary.
  const { data: refreshed } = await db
    .from("meetings")
    .select("post_summary")
    .eq("id", meeting.id)
    .maybeSingle();
  const internalSummary = (refreshed?.post_summary as string | null) ?? payload.granolaSummary ?? "";
  if (!internalSummary) {
    result.followup_skipped_reason = "no summary available to ground the follow-up";
    return result;
  }

  // Resolve sender identity from user_settings.
  const { data: settings } = await db
    .from("user_settings")
    .select("first_name, last_name, job_title")
    .eq("user_id", meeting.owner_id)
    .maybeSingle();
  const senderFirst = (settings?.first_name as string | null) ?? "Jim";
  const senderName = displayName({
    id: meeting.owner_id,
    first_name: (settings?.first_name as string | null) ?? null,
    last_name: (settings?.last_name as string | null) ?? null,
    email: null,
  });
  const senderSignoff =
    `${senderName}${(settings?.job_title as string | null) ? ` — ${settings?.job_title}` : ""}, Credit Canary`;

  const org = pick(meeting.organisation);
  const deal = pick(meeting.deal);

  let draft;
  try {
    draft = await generateFollowup({
      contact_first_name: firstName(contact.full_name),
      sender_first_name: senderFirst,
      sender_signoff: senderSignoff,
      meeting_subject: meeting.subject ?? "our meeting",
      meeting_started_at: meeting.start_at,
      org_name: org?.name ?? null,
      deal_title: deal?.title ?? null,
      deal_stage: deal?.stage ?? null,
      brief: meeting.brief ?? null,
      internal_summary: internalSummary,
      transcript_excerpt: payload.transcript.slice(0, 6000),
    });
  } catch (e) {
    result.errors.push(`draft follow-up: ${(e as Error).message}`);
    return result;
  }
  if (draft.confidence < 0.4) {
    result.followup_skipped_reason = `low confidence (${draft.confidence.toFixed(2)}) — transcript probably too thin`;
    return result;
  }

  // Insert as 'queued' so it lands in /queue for review instead of
  // shipping straight away. Operator approves manually — important for
  // first-touch-after-meeting emails where tone matters and the AI
  // doesn't always nail the relationship context.
  const { data: inserted, error: insErr } = await db
    .from("sends")
    .insert({
      contact_id: contact.id,
      subject: draft.subject,
      body_html: draft.body_html,
      body_text: draft.body_text,
      original_body_text: draft.body_text,
      status: "queued",
      owner_id: meeting.owner_id,
      angle: `Granola follow-up: ${payload.source}`,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    result.errors.push(`sends insert: ${insErr?.message ?? "no row"}`);
    return result;
  }

  // Pin the draft to the meeting so we don't re-draft on the next cron
  // tick. The status flips to 'sent' downstream when the operator
  // approves + the send cron picks it up.
  await db.from("meetings").update({ granola_followup_send_id: inserted.id }).eq("id", meeting.id);
  result.followup_sent = true; // semantically: a draft was successfully created (not literally sent)

  return result;
}
