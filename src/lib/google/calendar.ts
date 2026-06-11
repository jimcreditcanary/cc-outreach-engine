// Google Calendar via the per-user "secret address in iCal format".
//
// We deliberately do NOT use the Google Calendar API: it needs an OAuth app
// (Cloud console project, consent screen, verification for the calendar
// scope). The secret basic.ics URL is a capability URL every Google account
// already has — the operator pastes it once, exactly like a Granola token.
// It's read-only and includes attendees + organizer, which is all the CRM
// linking needs. Treat the URL itself as a secret: server-side only.
//
// Recurrence (RRULE) expansion is delegated to node-ical's
// expandRecurringEvent, which handles EXDATEs, RECURRENCE-ID overrides and
// timezone/DST shifts — the parts that are easy to get subtly wrong by hand.

import ical, { type Attendee, type CalendarResponse, type ParameterValue, type VEvent } from "node-ical";

export interface GoogleAttendee {
  name: string | null;
  email: string | null;
  /** Lowercased PARTSTAT: accepted / declined / needs-action / tentative. */
  response: string | null;
}

export interface GoogleEvent {
  /** Per-occurrence dedup key. ICS UIDs are shared across calendars (and
   *  across every instance of a recurring event), so recurring occurrences
   *  get the original occurrence time suffixed: "<uid>:<recurrenceISO>".
   *  Stable across reschedules of an instance (keyed on the ORIGINAL slot). */
  key: string;
  subject: string | null;
  start: Date;
  end: Date | null;
  location: string | null;
  online_url: string | null;
  description: string | null;
  attendees: GoogleAttendee[];
}

/** Secret addresses look like
 *  https://calendar.google.com/calendar/ical/<calendar-id>/private-<key>/basic.ics */
export function isGoogleIcsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "calendar.google.com" && u.pathname.endsWith(".ics");
  } catch {
    return false;
  }
}

export async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Google Calendar feed returned HTTP ${res.status} — re-copy the secret address (Google can reset it)`);
  const body = await res.text();
  if (!body.trimStart().startsWith("BEGIN:VCALENDAR")) {
    throw new Error("That URL didn't return a calendar feed — copy the 'Secret address in iCal format' from Google Calendar settings");
  }
  return body;
}

/** node-ical values are either plain or { params, val }. */
function pv(v: ParameterValue<string, Record<string, string>> | undefined): string | null {
  if (v == null) return null;
  const s = typeof v === "object" ? v.val : v;
  const trimmed = String(s).trim();
  return trimmed === "" ? null : trimmed;
}

function parseAttendees(ev: VEvent): GoogleAttendee[] {
  const raw: Attendee[] = ev.attendee == null ? [] : Array.isArray(ev.attendee) ? ev.attendee : [ev.attendee];
  const out: GoogleAttendee[] = [];
  for (const a of raw) {
    const val = typeof a === "object" ? a.val : a;
    const email = String(val ?? "").replace(/^mailto:/i, "").trim().toLowerCase() || null;
    if (!email || !email.includes("@")) continue;
    const cn = typeof a === "object" ? (a.params?.CN ?? null) : null;
    // Google often sets CN to the bare email for external invitees — that's
    // not a name, leave it null so the UI falls back to the CRM contact name.
    const name = cn && cn.toLowerCase() !== email ? cn : null;
    const partstat = typeof a === "object" ? (a.params?.PARTSTAT ?? null) : null;
    out.push({ name, email, response: partstat ? String(partstat).toLowerCase() : null });
  }
  return out;
}

const MEETING_URL_RE = /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s"<>]*/i;

function onlineUrl(ev: VEvent, description: string | null, location: string | null): string | null {
  // X-GOOGLE-CONFERENCE carries the Meet link; node-ical strips the X-.
  const conf = pv((ev as unknown as Record<string, ParameterValue<string, Record<string, string>> | undefined>)["GOOGLE-CONFERENCE"]);
  if (conf?.startsWith("https://")) return conf;
  return location?.match(MEETING_URL_RE)?.[0] ?? description?.match(MEETING_URL_RE)?.[0] ?? null;
}

function toGoogleEvent(ev: VEvent, key: string, start: Date, end: Date | null): GoogleEvent {
  const description = pv(ev.description);
  const location = pv(ev.location);
  return {
    key,
    subject: pv(ev.summary),
    start,
    end,
    location,
    online_url: onlineUrl(ev, description, location),
    description,
    attendees: parseAttendees(ev),
  };
}

/** Flatten a parsed feed into the [from, to] window: single events as-is,
 *  recurring events expanded per-occurrence (with overrides + EXDATEs). */
export function eventsInWindow(parsed: CalendarResponse, from: Date, to: Date): GoogleEvent[] {
  const out: GoogleEvent[] = [];
  for (const comp of Object.values(parsed)) {
    if (!comp || (comp as VEvent).type !== "VEVENT") continue;
    const ev = comp as VEvent;
    if (ev.status === "CANCELLED") continue;

    if (ev.rrule) {
      for (const inst of ical.expandRecurringEvent(ev, { from, to })) {
        const instEv = inst.event as VEvent;
        if (instEv.status === "CANCELLED") continue;
        // Key on the ORIGINAL occurrence slot so a rescheduled instance
        // updates its row instead of orphaning it.
        const slot = (instEv.recurrenceid ?? inst.start) as Date;
        out.push(toGoogleEvent(instEv, `${ev.uid}:${slot.toISOString()}`, inst.start, inst.end ?? null));
      }
      continue;
    }

    if (!ev.start || ev.start.getTime() < from.getTime() || ev.start.getTime() > to.getTime()) continue;
    // A detached override whose master isn't in the feed still carries a
    // recurrenceid — key it like an occurrence so siblings don't collide.
    const key = ev.recurrenceid ? `${ev.uid}:${(ev.recurrenceid as Date).toISOString()}` : ev.uid;
    out.push(toGoogleEvent(ev, key, ev.start, ev.end ?? null));
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function parseIcs(body: string): CalendarResponse {
  return ical.sync.parseICS(body);
}
