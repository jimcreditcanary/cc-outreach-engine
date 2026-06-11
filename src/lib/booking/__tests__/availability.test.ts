import { describe, expect, it } from "vitest";
import { computeSlots, zonedTimeToUtc, type BookingConfig } from "../availability";
import { buildInviteIcs } from "../ics";

const CONFIG: BookingConfig = {
  durationMins: 30,
  bufferMins: 15,
  dayStart: "09:00",
  dayEnd: "17:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
  tz: "Europe/London",
  minNoticeHours: 4,
  horizonDays: 7,
};

describe("zonedTimeToUtc", () => {
  it("converts London wall-clock to UTC in summer (BST) and winter (GMT)", () => {
    expect(zonedTimeToUtc("2026-06-15", "09:00", "Europe/London").toISOString()).toBe("2026-06-15T08:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-15", "09:00", "Europe/London").toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("handles a wall-clock time on the DST-change day itself", () => {
    // Clocks went forward 29 Mar 2026 01:00 GMT → 09:00 that day is BST.
    expect(zonedTimeToUtc("2026-03-29", "09:00", "Europe/London").toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("works for non-UK zones", () => {
    expect(zonedTimeToUtc("2026-06-15", "09:00", "America/New_York").toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });
});

describe("computeSlots", () => {
  // Friday 12 Jun 2026, 08:00 UTC (09:00 London).
  const now = new Date("2026-06-12T08:00:00.000Z");

  it("respects working days, hours and minimum notice", () => {
    const slots = computeSlots(CONFIG, [], now);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const day = s.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/London" }).toLowerCase();
      expect(["sat", "sun"]).not.toContain(day);
      // ≥ 4h notice
      expect(s.getTime()).toBeGreaterThanOrEqual(now.getTime() + 4 * 3_600_000);
      // inside 09:00–17:00 London → 08:00–16:00 UTC in June
      const utcHour = s.getUTCHours();
      expect(utcHour).toBeGreaterThanOrEqual(8);
      expect(utcHour).toBeLessThan(16);
    }
    // First bookable slot today: 13:00 London (12:00 UTC) — 09:00 + 4h notice,
    // snapped to the 30-min grid from 09:00.
    expect(slots[0]!.toISOString()).toBe("2026-06-12T12:00:00.000Z");
  });

  it("blocks slots overlapping busy intervals, including the buffer", () => {
    // Busy Mon 15 Jun 10:00–10:30 London (09:00–09:30 UTC).
    const busy = [{ start: Date.parse("2026-06-15T09:00:00Z"), end: Date.parse("2026-06-15T09:30:00Z") }];
    const slots = computeSlots(CONFIG, busy, now).map((s) => s.toISOString());
    // The meeting itself…
    expect(slots).not.toContain("2026-06-15T09:00:00.000Z");
    // …and the 15-min buffer kills the adjacent slots on both sides.
    expect(slots).not.toContain("2026-06-15T08:30:00.000Z");
    expect(slots).not.toContain("2026-06-15T09:30:00.000Z");
    // Two slots clear of the buffer survive.
    expect(slots).toContain("2026-06-15T08:00:00.000Z");
    expect(slots).toContain("2026-06-15T10:00:00.000Z");
  });

  it("gives an empty list when every day is disabled", () => {
    expect(computeSlots({ ...CONFIG, days: [] }, [], now)).toEqual([]);
  });
});

describe("buildInviteIcs", () => {
  it("emits a METHOD:REQUEST invite with escaped text and both parties", () => {
    const ics = buildInviteIcs({
      uid: "booking-123@veepveep.co.uk",
      start: new Date("2026-06-15T09:00:00Z"),
      end: new Date("2026-06-15T09:30:00Z"),
      subject: "Jim Fell × Jane; Smith, Co",
      description: "Line one\nLine two",
      organizerName: "Jim Fell",
      organizerEmail: "jimfell@creditcanary.co.uk",
      attendeeName: "Jane Smith",
      attendeeEmail: "jane@lender.co.uk",
    });
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("DTSTART:20260615T090000Z");
    expect(ics).toContain("SUMMARY:Jim Fell × Jane\\; Smith\\, Co");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics).toContain("mailto:jane@lender.co.uk");
    expect(ics).toContain("mailto:jimfell@creditcanary.co.uk");
    // CRLF line endings (some clients are strict)
    expect(ics.includes("\r\n")).toBe(true);
  });
});
