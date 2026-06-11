// Validates our node-ical usage against a realistic Google secret-feed
// snippet. The recurring-event case matters most: the weekly call below is
// created in January (GMT) and we expand June occurrences (BST) — if the
// library or our wiring mishandled DST, every summer meeting would land an
// hour off and the time±15min Granola matcher would silently stop working.

import { describe, expect, it } from "vitest";
import { eventsInWindow, isGoogleIcsUrl, parseIcs } from "../calendar";

const FEED = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:jim@example.com",
  "X-WR-TIMEZONE:Europe/London",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/London",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0000",
  "TZOFFSETTO:+0100",
  "TZNAME:BST",
  "DTSTART:19700329T010000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0000",
  "TZNAME:GMT",
  "DTSTART:19701025T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  // ── Single event with attendees + Meet link ─────────────────────────
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/London:20260611T140000",
  "DTEND;TZID=Europe/London:20260611T143000",
  "DTSTAMP:20260601T120000Z",
  "UID:single-evt-1@google.com",
  "ORGANIZER;CN=Jim Fell:mailto:jim@example.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Jim Fe",
  " ll;X-NUM-GUESTS=0:mailto:jim@example.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=sa",
  " rah@lender.co.uk;X-NUM-GUESTS=0:mailto:sarah@lender.co.uk",
  "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
  "SUMMARY:Credit Canary intro — Lender Ltd",
  "STATUS:CONFIRMED",
  "END:VEVENT",
  // ── Weekly recurring, created in GMT, with one EXDATE in June ───────
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/London:20260107T100000",
  "DTEND;TZID=Europe/London:20260107T104500",
  "RRULE:FREQ=WEEKLY;BYDAY=WE",
  "EXDATE;TZID=Europe/London:20260617T100000",
  "DTSTAMP:20260101T090000Z",
  "UID:weekly-evt-1@google.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ross T",
  " ully:mailto:ross@creditcanary.co.uk",
  "SUMMARY:Weekly pipeline call",
  "STATUS:CONFIRMED",
  "END:VEVENT",
  // ── Cancelled event — must never surface ────────────────────────────
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/London:20260612T090000",
  "DTEND;TZID=Europe/London:20260612T093000",
  "DTSTAMP:20260601T120000Z",
  "UID:cancelled-evt-1@google.com",
  "SUMMARY:Ghost meeting",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const FROM = new Date("2026-06-01T00:00:00Z");
const TO = new Date("2026-06-30T23:59:59Z");

describe("eventsInWindow", () => {
  const events = eventsInWindow(parseIcs(FEED), FROM, TO);

  it("keeps the single event with subject, Meet link and attendees", () => {
    const single = events.find((e) => e.key === "single-evt-1@google.com");
    expect(single).toBeDefined();
    expect(single!.subject).toBe("Credit Canary intro — Lender Ltd");
    expect(single!.online_url).toBe("https://meet.google.com/abc-defg-hij");
    // 14:00 London in June = 13:00 UTC (BST)
    expect(single!.start.toISOString()).toBe("2026-06-11T13:00:00.000Z");
    expect(single!.attendees).toEqual([
      { name: "Jim Fell", email: "jim@example.com", response: "accepted" },
      // CN equal to the email is not a real name — normalised to null
      { name: null, email: "sarah@lender.co.uk", response: "needs-action" },
    ]);
  });

  it("expands the weekly series across the GMT→BST boundary at the right UTC instants", () => {
    const weekly = events.filter((e) => e.key.startsWith("weekly-evt-1@google.com:"));
    // June Wednesdays: 3, 10, 17 (EXDATE), 24 → three occurrences
    expect(weekly.map((e) => e.start.toISOString())).toEqual([
      "2026-06-03T09:00:00.000Z", // 10:00 BST
      "2026-06-10T09:00:00.000Z",
      "2026-06-24T09:00:00.000Z",
    ]);
    // Distinct per-occurrence dedup keys
    expect(new Set(weekly.map((e) => e.key)).size).toBe(3);
    // Duration carried through to each instance
    expect(weekly[0]!.end!.toISOString()).toBe("2026-06-03T09:45:00.000Z");
  });

  it("drops cancelled events", () => {
    expect(events.some((e) => e.key.startsWith("cancelled-evt-1"))).toBe(false);
  });
});

describe("isGoogleIcsUrl", () => {
  it("accepts the secret address shape and rejects everything else", () => {
    expect(isGoogleIcsUrl("https://calendar.google.com/calendar/ical/jim%40example.com/private-0d7e/basic.ics")).toBe(true);
    expect(isGoogleIcsUrl("http://calendar.google.com/calendar/ical/x/private-y/basic.ics")).toBe(false);
    expect(isGoogleIcsUrl("https://evil.example.com/calendar/ical/x/basic.ics")).toBe(false);
    expect(isGoogleIcsUrl("https://calendar.google.com/calendar/embed?src=x")).toBe(false);
    expect(isGoogleIcsUrl("not a url")).toBe(false);
  });
});
