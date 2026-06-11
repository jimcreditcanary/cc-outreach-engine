// Busy intervals for one operator across every source we know about:
//   - Outlook (live Graph calendarView; skips events marked "free")
//   - Google Calendar (secret ICS feed; skips TRANSP:TRANSPARENT)
//   - the meetings table (covers booking-page bookings instantly, even
//     before they appear in a calendar feed — this is the double-booking
//     backstop for Google's lazily-refreshing ICS cache)
// Sources the operator hasn't connected are skipped silently; a CONNECTED
// source that errors throws, because guessing availability without it
// risks double-booking.

import { serviceClient } from "../db/client";
import { getValidAccessToken } from "../microsoft/oauth";
import { listEvents } from "../microsoft/graph";
import { eventsInWindow, fetchIcs, parseIcs } from "../google/calendar";
import type { Interval } from "./availability";

type DB = ReturnType<typeof serviceClient>;

/** Graph returns naive UTC datetimes ("2026-06-12T09:00:00.0000000") when
 *  asked for UTC — new Date() would read those as LOCAL time off-Vercel. */
function parseUtc(s: string): Date {
  return new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

export async function loadBusyIntervals(db: DB, userId: string, from: Date, to: Date): Promise<Interval[]> {
  const busy: Interval[] = [];

  // Outlook
  const accessToken = await getValidAccessToken(db, userId);
  if (accessToken) {
    const events = await listEvents(accessToken, from.toISOString(), to.toISOString());
    for (const e of events) {
      if (e.isCancelled || e.showAs === "free") continue;
      busy.push({ start: parseUtc(e.start.dateTime).getTime(), end: parseUtc(e.end.dateTime).getTime() });
    }
  }

  // Google
  const { data: settings } = await db
    .from("user_settings")
    .select("google_ics_url")
    .eq("user_id", userId)
    .maybeSingle();
  const icsUrl = (settings?.google_ics_url as string | null) ?? null;
  if (icsUrl) {
    for (const e of eventsInWindow(parseIcs(await fetchIcs(icsUrl)), from, to)) {
      if (e.transparent) continue;
      busy.push({ start: e.start.getTime(), end: (e.end ?? new Date(e.start.getTime() + 30 * 60_000)).getTime() });
    }
  }

  // CRM meetings (window overlap, not start-in-window: a meeting that
  // started before `from` can still block the first slots)
  const { data: meetings } = await db
    .from("meetings")
    .select("start_at, end_at")
    .eq("owner_id", userId)
    .gte("start_at", new Date(from.getTime() - 8 * 3_600_000).toISOString())
    .lte("start_at", to.toISOString());
  for (const m of meetings ?? []) {
    const start = new Date(m.start_at as string).getTime();
    const end = m.end_at ? new Date(m.end_at as string).getTime() : start + 30 * 60_000;
    busy.push({ start, end });
  }

  return busy;
}
