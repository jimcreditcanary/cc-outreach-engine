// Google Calendar → meetings sync. Same contract as the Outlook sync in
// lib/meetings/sync.ts: window pull, attendee→contact matching, org/deal
// inference with existing-wins merge, owner_id stamped with whose calendar
// the row came from. Dedup key is (owner_id, google_event_uid) because ICS
// UIDs — unlike Microsoft event ids — are shared across calendars: two
// operators invited to the same event each keep their own row.

import { serviceClient } from "../db/client";
import {
  inferMeetingLinks,
  loadLinkContext,
  type ExistingLinks,
  type StoredAttendee,
  type SyncResult,
} from "../meetings/sync";
import { eventsInWindow, fetchIcs, parseIcs } from "./calendar";

type DB = ReturnType<typeof serviceClient>;

/** Same window as the Outlook sync going forward, but a week back instead
 *  of a day — /meetings shows the last 7 days, and Granola matches on past
 *  meetings, so recent history needs to exist. */
const PAST_DAYS = 7;
const FUTURE_DAYS = 14;

export async function syncGoogleCalendar(db: DB, userId: string): Promise<SyncResult> {
  const { data: settings } = await db
    .from("user_settings")
    .select("google_ics_url")
    .eq("user_id", userId)
    .maybeSingle();
  const url = (settings?.google_ics_url as string | null) ?? null;
  if (!url) {
    return { ok: false, reason: "Google Calendar not connected — paste your secret iCal address on /meetings", fetched: 0, upserted: 0, linked_to_contact: 0 };
  }

  const from = new Date(Date.now() - PAST_DAYS * 86_400_000);
  const to = new Date(Date.now() + FUTURE_DAYS * 86_400_000);
  const events = eventsInWindow(parseIcs(await fetchIcs(url)), from, to);

  const { byEmail, openDealByOrg, teamEmails } = await loadLinkContext(db);

  // Existing links for this operator's Google rows — manual picks stay sticky.
  const keys = events.map((e) => e.key);
  const existingByKey = new Map<string, ExistingLinks>();
  if (keys.length > 0) {
    const { data: existing } = await db
      .from("meetings")
      .select("google_event_uid, organisation_id, primary_contact_id, deal_id")
      .eq("owner_id", userId)
      .in("google_event_uid", keys);
    for (const m of existing ?? []) {
      existingByKey.set(m.google_event_uid as string, {
        organisation_id: (m.organisation_id as string | null) ?? null,
        primary_contact_id: (m.primary_contact_id as string | null) ?? null,
        deal_id: (m.deal_id as string | null) ?? null,
      });
    }
  }

  let upserted = 0;
  let linkedToContact = 0;

  for (const e of events) {
    const attendees: StoredAttendee[] = e.attendees.map((a) => ({
      name: a.name,
      email: a.email,
      response: a.response,
      contact_id: a.email ? byEmail.get(a.email)?.id ?? null : null,
    }));

    const links = inferMeetingLinks({
      attendees,
      byEmail,
      openDealByOrg,
      teamEmails,
      existing: existingByKey.get(e.key) ?? null,
    });
    if (links.primary_contact_id) linkedToContact++;

    const isPast = (e.end ?? e.start).getTime() < Date.now();

    const { error } = await db.from("meetings").upsert(
      {
        google_event_uid: e.key,
        subject: e.subject,
        start_at: e.start.toISOString(),
        end_at: e.end?.toISOString() ?? null,
        location: e.location,
        online_url: e.online_url,
        body_preview: e.description ? e.description.slice(0, 500) : null,
        attendees,
        organisation_id: links.organisation_id,
        primary_contact_id: links.primary_contact_id,
        deal_id: links.deal_id,
        owner_id: userId,
        status: isPast ? "done" : "upcoming",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,google_event_uid" },
    );
    if (error) throw error;
    upserted++;
  }

  return { ok: true, fetched: events.length, upserted, linked_to_contact: linkedToContact };
}
