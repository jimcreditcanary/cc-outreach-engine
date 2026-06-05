// Diagnose why a specific meeting's Granola transcript isn't being pulled.
//
//   npx tsx scripts/diagnose-granola.ts <meeting_id>
//
// Walks the same path syncGranolaForUser uses:
//   1. Load the meeting + owner + Granola token
//   2. List notes from Granola (catch + surface API errors)
//   3. Try to match by ms_event_id; fall back to time + attendee
//   4. Report exactly which gate failed.

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";
import { listNotes, getNoteWithTranscript } from "../src/lib/granola/client";

const meetingId = process.argv[2];
if (!meetingId) {
  console.error("Usage: tsx scripts/diagnose-granola.ts <meeting_id>");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  console.log(`\n━━━ MEETING ${meetingId}`);
  const { data: m, error: mErr } = await db
    .from("meetings")
    .select("id, subject, start_at, end_at, sales_relevant, ms_event_id, owner_id, attendees, transcript, granola_note_id, granola_synced_at, primary_contact:contacts(id, full_name, email)")
    .eq("id", meetingId)
    .maybeSingle();
  if (mErr) { console.error("meeting lookup:", mErr); process.exit(1); }
  if (!m) { console.log("Meeting not found."); process.exit(0); }
  console.log(`subject       : ${m.subject}`);
  console.log(`start_at      : ${m.start_at}`);
  console.log(`sales_relevant: ${m.sales_relevant}`);
  console.log(`ms_event_id   : ${m.ms_event_id ?? "(none)"}`);
  console.log(`owner_id      : ${m.owner_id ?? "(none)"}`);
  console.log(`transcript    : ${m.transcript ? `${(m.transcript as string).length} chars` : "(empty)"}`);
  console.log(`granola_note_id   : ${m.granola_note_id ?? "(none)"}`);
  console.log(`granola_synced_at : ${m.granola_synced_at ?? "(never)"}`);
  const pc = Array.isArray(m.primary_contact) ? m.primary_contact[0] : m.primary_contact;
  console.log(`primary contact: ${pc?.full_name ?? "—"} <${pc?.email ?? "no-email"}>`);
  const attendees = (m.attendees ?? []) as { email?: string | null }[];
  console.log(`attendees     : ${attendees.length} (${attendees.map((a) => a.email).filter(Boolean).join(", ")})`);

  // ── Gate checks against the sync engine's filters ────────────────
  console.log(`\n──── ENGINE GATE CHECKS`);
  if (!m.owner_id) {
    console.log(`  ❌ No owner_id — cron only syncs meetings whose owner_id matches a user with a Granola token.`);
    process.exit(0);
  }
  if (!m.sales_relevant) {
    console.log(`  ❌ sales_relevant=false — engine explicitly skips non-sales meetings. Flip on the meeting page.`);
    process.exit(0);
  }

  // Owner's token
  const { data: settings } = await db
    .from("user_settings")
    .select("granola_api_token")
    .eq("user_id", m.owner_id)
    .maybeSingle();
  const token = (settings?.granola_api_token as string | null) ?? null;
  if (!token) {
    console.log(`  ❌ Owner ${m.owner_id} has no granola_api_token in user_settings. Connect at /settings.`);
    process.exit(0);
  }
  console.log(`  ✓ Owner has a Granola token (ending ${token.slice(-4)})`);

  // ── Hit Granola API ──────────────────────────────────────────────
  console.log(`\n──── GRANOLA API`);
  let notes;
  try {
    notes = (await listNotes(token, { pageSize: 30 })).notes;
    console.log(`  ✓ listNotes returned ${notes.length} note(s)`);
  } catch (e) {
    console.log(`  ❌ listNotes threw: ${(e as Error).message}`);
    console.log(`     This is the show-stopper. Likely causes:`);
    console.log(`       1. Token invalid / expired (re-paste at /settings)`);
    console.log(`       2. Granola API endpoint/shape has changed since I wrote the client`);
    console.log(`       3. Your plan tier doesn't include API access`);
    process.exit(1);
  }

  if (notes.length === 0) {
    console.log(`  ℹ Granola returned zero notes for the last 2 days — no recordings to match.`);
    process.exit(0);
  }

  // Dump what we saw
  console.log(`\n  Notes recently visible to your Granola account:`);
  for (const n of notes.slice(0, 20)) {
    console.log(`    - id=${n.id}  start=${n.started_at ?? "?"}  cal=${n.calendar_event_id ?? "—"}  title="${(n.title ?? "").slice(0, 60)}"  attendees=[${n.attendee_emails.join(", ")}]`);
  }

  // ── Try to match against this meeting ────────────────────────────
  console.log(`\n──── MATCH`);
  const meetingTs = new Date(m.start_at as string).getTime();
  const WINDOW = 15 * 60 * 1000;

  // Primary: ms_event_id
  if (m.ms_event_id) {
    const exact = notes.find((n) => n.calendar_event_id === m.ms_event_id);
    if (exact) {
      console.log(`  ✓ EXACT MATCH on calendar_event_id → Granola note ${exact.id}`);
      // Try to pull transcript
      try {
        const full = await getNoteWithTranscript(token, exact.id);
        console.log(`  transcript length: ${full.transcript ? `${full.transcript.length} chars` : "EMPTY (still processing on Granola side — try again later)"}`);
      } catch (e) {
        console.log(`  ❌ getNoteWithTranscript threw: ${(e as Error).message}`);
      }
      process.exit(0);
    } else {
      console.log(`  ℹ No Granola note has calendar_event_id matching this meeting's ms_event_id (${m.ms_event_id}).`);
      console.log(`     This is normal if Granola didn't capture the source calendar event id — falling through to fuzzy match.`);
    }
  }

  // Fallback: time window + attendee overlap
  const ourEmails = new Set(attendees.map((a) => (a.email ?? "").trim().toLowerCase()).filter(Boolean));
  const inWindow = notes.filter((n) => {
    if (!n.started_at) return false;
    return Math.abs(new Date(n.started_at).getTime() - meetingTs) <= WINDOW;
  });
  console.log(`  Notes within ±15 min of meeting start: ${inWindow.length}`);
  if (inWindow.length === 0) {
    console.log(`  ❌ No Granola note within ±15 min of ${m.start_at}. Was Granola actually recording at that time?`);
    process.exit(0);
  }
  for (const n of inWindow) {
    const overlap = n.attendee_emails.filter((e) => ourEmails.has(e));
    console.log(`    - note ${n.id} at ${n.started_at}: attendee overlap=${overlap.length} (${overlap.join(", ") || "none"})`);
  }
  const withEmailMatch = inWindow.find((n) => n.attendee_emails.some((e) => ourEmails.has(e)));
  if (withEmailMatch) {
    console.log(`  ✓ FUZZY MATCH (time + attendee email) → Granola note ${withEmailMatch.id}`);
  } else {
    console.log(`  ⚠ No attendee email overlap. Engine would still take the closest-time note as fallback.`);
    const closest = inWindow.sort((a, b) =>
      Math.abs(new Date(a.started_at!).getTime() - meetingTs) -
      Math.abs(new Date(b.started_at!).getTime() - meetingTs))[0]!;
    console.log(`     Closest-time fallback would be: ${closest.id}`);
  }
})();
