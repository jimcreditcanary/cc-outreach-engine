// Granola sync engine. Once per cron tick, for every operator whose
// user_settings.granola_api_token is set:
//
//   1. listNotes() — shallow list (id, title, created_at)
//   2. Narrow to notes whose created_at falls anywhere near the operator's
//      sales-relevant meetings in the last 7 days (so we don't fetch
//      detail for ancient unrelated notes).
//   3. For each candidate: GET /v1/notes/{id} → full record with
//      calendar_event_id + attendees + transcript + summary_text.
//   4. Match against meetings:
//        primary: note.calendar_event_id === meetings.ms_event_id (exact)
//        fallback: time window ±15 min + attendee email overlap
//   5. Hand off to applyTranscriptToMeeting which writes the transcript,
//      runs the post-meeting summary, drafts + sends the follow-up email.
//
// Idempotent: re-running won't re-pull (skip when meetings.granola_note_id
// already matches the note) and won't re-send (apply* checks
// granola_followup_send_id null before drafting).

import type { SupabaseClient } from "@supabase/supabase-js";
import { listNotes, getNoteWithTranscript, type GranolaNote } from "./client";
import { applyTranscriptToMeeting } from "./applyTranscript";

export interface SyncResult {
  operators_checked: number;
  notes_seen: number;
  meetings_matched: number;
  transcripts_pulled: number;
  followups_sent: number;
  followups_skipped_low_confidence: number;
  errors: string[];
}

const MATCH_WINDOW_MS = 15 * 60 * 1000;
/** How far back/forward to consider a note's created_at "plausibly tied"
 *  to one of our meetings. Loose so we don't miss anything. */
const PLAUSIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

interface MeetingRow {
  id: string;
  ms_event_id: string | null;
  google_event_uid: string | null;
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

export async function syncGranolaForUser(
  db: SupabaseClient,
  userId: string,
  apiToken: string,
  result: SyncResult,
): Promise<void> {
  // ── 1. Load operator's recent sales-relevant meetings ─────────────
  // Window covers last 7 days back and 1 day forward (Granola notes for
  // about-to-happen meetings are rare but possible).
  const windowStart = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const windowEnd = new Date(Date.now() + 1 * 86_400_000).toISOString();
  const meetingsSelect = (withGoogleUid: boolean) => {
    // Plain-string select (not a template literal type) — the dynamic
    // column makes supabase-js's query parser blow the type-complexity cap.
    const cols: string = `
      id, ms_event_id, ${withGoogleUid ? "google_event_uid, " : ""}subject, start_at, attendees, transcript, granola_note_id,
      granola_followup_send_id, brief, owner_id, organisation_id, deal_id,
      organisation:organisations(name),
      primary_contact:contacts(id, full_name, email),
      deal:deals(title, stage)
    `;
    return db
    .from("meetings")
    .select(cols)
    .eq("owner_id", userId)
    .eq("sales_relevant", true)
    .gte("start_at", windowStart)
    .lte("start_at", windowEnd)
    .limit(500);
  };
  let { data: meetingsData, error: mErr } = await meetingsSelect(true);
  // Migration 034 (google_event_uid) not applied yet — Granola must keep
  // working for Outlook meetings, so retry without the column.
  if (mErr?.message.includes("google_event_uid")) {
    ({ data: meetingsData, error: mErr } = await meetingsSelect(false));
  }
  if (mErr) {
    result.errors.push(`meetings(${userId}): ${mErr.message}`);
    return;
  }
  const meetings = (meetingsData ?? []) as unknown as MeetingRow[];
  if (meetings.length === 0) return;

  // ── 2. List Granola notes (server-side date filter + pagination) ──
  // Filter to notes UPDATED in our meeting window so we re-pull when a
  // transcript that was processing earlier completes. Granola caps
  // page_size at 30 so we walk the cursor until hasMore=false or until
  // we've collected enough.
  const stubs: GranolaNote[] = [];
  let cursor: string | undefined;
  try {
    do {
      const page = await listNotes(apiToken, {
        updatedAfter: windowStart,
        pageSize: 30,
        cursor,
      });
      stubs.push(...page.notes);
      cursor = page.hasMore && page.cursor ? page.cursor : undefined;
      if (stubs.length > 300) break; // hard safety cap per cron tick
    } while (cursor);
  } catch (e) {
    result.errors.push(`listNotes(${userId}): ${(e as Error).message}`);
    return;
  }
  result.notes_seen += stubs.length;
  if (stubs.length === 0) return;

  // ── 3. Narrow to notes plausibly tied to any of our meetings ──────
  // Cheap pre-filter on the shallow `started_at` (which is the note's
  // created_at in the list endpoint) so we don't burn detail-API calls
  // on every note in the workspace.
  const meetingTimestamps = meetings.map((m) => new Date(m.start_at).getTime());
  const earliestMeeting = Math.min(...meetingTimestamps);
  const latestMeeting = Math.max(...meetingTimestamps);
  const candidates = stubs.filter((n) => {
    if (!n.started_at) return true; // can't pre-filter — fetch detail anyway
    const ts = new Date(n.started_at).getTime();
    return ts >= earliestMeeting - PLAUSIBILITY_WINDOW_MS && ts <= latestMeeting + PLAUSIBILITY_WINDOW_MS;
  });

  // Index meetings by calendar event id for O(1) primary-key match.
  // Outlook rows key on ms_event_id directly. Google rows: Granola's
  // calendar_event_id is the Google API event id, which the ICS UID embeds
  // as "<id>@google.com" (recurring-occurrence keys carry a ":<ts>" suffix
  // and fall through to the time+attendee fallback instead).
  const byEventId = new Map<string, MeetingRow>();
  for (const m of meetings) {
    if (m.ms_event_id) byEventId.set(m.ms_event_id, m);
    const gid = m.google_event_uid?.match(/^([^:@]+)@google\.com$/)?.[1];
    if (gid) byEventId.set(gid, m);
  }
  // Also index by granola_note_id we've already synced — short-circuit re-runs.
  const alreadySyncedNoteIds = new Set<string>();
  for (const m of meetings) {
    if (m.granola_note_id && m.granola_followup_send_id) alreadySyncedNoteIds.add(m.granola_note_id);
  }

  // ── 4. For each candidate, fetch detail + match + apply ───────────
  for (const stub of candidates) {
    // Already fully processed in a previous tick → skip without burning
    // a detail API call.
    if (alreadySyncedNoteIds.has(stub.id)) continue;

    // Fetch the full note (calendar_event_id, attendees, transcript).
    let full: GranolaNote;
    try {
      full = await getNoteWithTranscript(apiToken, stub.id);
    } catch (e) {
      result.errors.push(`getNote(${stub.id}): ${(e as Error).message}`);
      continue;
    }

    // ── MATCH ──
    let matched: MeetingRow | undefined;

    // Primary: exact calendar event id match (Outlook or Google).
    if (full.calendar_event_id) matched = byEventId.get(full.calendar_event_id);

    // Fallback: time window ±15 min + attendee email overlap.
    if (!matched && full.started_at) {
      const noteTs = new Date(full.started_at).getTime();
      if (isFinite(noteTs)) {
        const inWindow = meetings.filter(
          (m) => Math.abs(new Date(m.start_at).getTime() - noteTs) <= MATCH_WINDOW_MS,
        );
        if (full.attendee_emails.length > 0) {
          const noteEmails = new Set(full.attendee_emails);
          matched = inWindow.find((m) => {
            const ours = (m.attendees ?? [])
              .map((a) => (a?.email ?? "").trim().toLowerCase())
              .filter(Boolean);
            return ours.some((e) => noteEmails.has(e));
          });
        }
        // Last resort: closest start-time.
        if (!matched && inWindow.length > 0) {
          matched = inWindow.sort(
            (a, b) =>
              Math.abs(new Date(a.start_at).getTime() - noteTs) -
              Math.abs(new Date(b.start_at).getTime() - noteTs),
          )[0];
        }
      }
    }
    if (!matched) continue;
    result.meetings_matched++;

    // ── TRANSCRIPT GUARD ──
    // Granola fills transcript only after processing finishes. Empty/
    // short transcript = try again next tick. Use granola_summary as a
    // fallback ground for the follow-up when transcript is genuinely
    // unavailable (some notes never get one).
    const hasUsableContent =
      (full.transcript?.trim().length ?? 0) >= 200 ||
      (full.granola_summary?.trim().length ?? 0) >= 100;
    if (!hasUsableContent) continue;

    // ── APPLY ──
    const applied = await applyTranscriptToMeeting(db, matched, {
      transcript: full.transcript ?? full.granola_summary ?? "",
      granolaSummary: full.granola_summary,
      granolaNoteId: full.id,
      source: "granola-api",
    });
    if (applied.transcript_written) result.transcripts_pulled++;
    if (applied.followup_sent) result.followups_sent++;
    if (applied.followup_skipped_reason?.includes("low confidence")) {
      result.followups_skipped_low_confidence++;
    }
    for (const err of applied.errors) result.errors.push(`${matched.id}: ${err}`);
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
