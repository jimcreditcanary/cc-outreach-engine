// Slot computation for the public booking page. Pure — no DB, no fetch —
// so the timezone/DST edges are unit-testable.
//
// The operator's working hours are wall-clock times in THEIR timezone
// ("09:00–17:00 Europe/London"); slots are UTC instants. The conversion
// uses Intl (no tz library): format the candidate instant in the target
// zone, diff against its UTC fields, converge in two passes (the second
// pass catches instants that straddle a DST transition).

export interface Interval {
  /** epoch ms */
  start: number;
  end: number;
}

export interface BookingConfig {
  durationMins: number;
  bufferMins: number;
  /** "HH:MM" wall-clock in `tz` */
  dayStart: string;
  dayEnd: string;
  /** lowercase three-letter day names: ["mon","tue",...] */
  days: string[];
  tz: string;
  minNoticeHours: number;
  horizonDays: number;
}

/** Offset between "the wall-clock in tz read as UTC" and the real instant. */
function tzOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour"); // midnight renders as 24 in some ICU versions
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** "2026-06-12" + "09:00" in tz → the UTC instant of that wall-clock time. */
export function zonedTimeToUtc(ymd: string, hm: string, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let guess = wall - tzOffsetMs(tz, new Date(wall));
  guess = wall - tzOffsetMs(tz, new Date(guess));
  return new Date(guess);
}

/** The calendar date + weekday of an instant as seen in tz. */
function dateInTz(at: Date, tz: string): { ymd: string; day: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => fmt.find((p) => p.type === type)?.value ?? "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    day: get("weekday").toLowerCase().slice(0, 3),
  };
}

/** All bookable slot starts (UTC) in the horizon. */
export function computeSlots(config: BookingConfig, busy: Interval[], now: Date): Date[] {
  const out: Date[] = [];
  const durMs = config.durationMins * 60_000;
  const bufMs = config.bufferMins * 60_000;
  const earliest = now.getTime() + config.minNoticeHours * 3_600_000;
  const enabled = new Set(config.days.map((d) => d.toLowerCase().slice(0, 3)));

  for (let i = 0; i <= config.horizonDays; i++) {
    // Walk days as seen in the OPERATOR's timezone, anchored at +12h so a
    // UTC/local date mismatch can't skip or double a day.
    const probe = new Date(now.getTime() + i * 86_400_000 + 12 * 3_600_000);
    const { ymd, day } = dateInTz(probe, config.tz);
    if (!enabled.has(day)) continue;

    const windowStart = zonedTimeToUtc(ymd, config.dayStart, config.tz).getTime();
    const windowEnd = zonedTimeToUtc(ymd, config.dayEnd, config.tz).getTime();

    for (let s = windowStart; s + durMs <= windowEnd; s += durMs) {
      if (s < earliest) continue;
      const e = s + durMs;
      // Buffer applies on both sides: a meeting ending at 10:00 with a
      // 15-min buffer blocks the 10:00 slot, not just overlapping ones.
      const clash = busy.some((b) => s < b.end + bufMs && e > b.start - bufMs);
      if (!clash) out.push(new Date(s));
    }
  }
  return out;
}
