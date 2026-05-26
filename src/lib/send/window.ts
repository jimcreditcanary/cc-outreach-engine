// Sending window (build brief §8): UK business hours only, never all at once.
// Pure — takes the clock as an argument so it's testable.

/** Hour-of-day (0–23) in Europe/London for a given instant. */
export function ukHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  // "24" can be returned at midnight by some runtimes — normalise.
  return Number(h) % 24;
}

/** Weekday in Europe/London (Mon–Fri = business day). */
export function isBusinessDay(now: Date): boolean {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(now);
  return !["Sat", "Sun"].includes(day);
}

/** True when it's a UK business day within [startHour, endHour). */
export function isWithinSendingWindow(now: Date, startHour: number, endHour: number): boolean {
  if (!isBusinessDay(now)) return false;
  const h = ukHour(now);
  return h >= startHour && h < endHour;
}
