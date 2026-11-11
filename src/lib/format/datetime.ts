// Workspace-timezone date formatting for SERVER-rendered timestamps.
//
// Vercel functions run with TZ=UTC, so a bare `toLocaleString("en-GB")`
// in a server component renders UTC wall-clock — one hour off for the
// whole of British Summer Time, which is exactly the kind of bug nobody
// notices until a meeting time doesn't match the calendar. Every server
// render goes through these helpers; client components (e.g. the public
// booking form) keep using the browser's own timezone instead.

export const APP_TZ = process.env.APP_TIMEZONE ?? "Europe/London";

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

export function fmtDate(v: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return toDate(v).toLocaleDateString("en-GB", { timeZone: APP_TZ, ...opts });
}

export function fmtTime(v: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return toDate(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: APP_TZ, ...opts });
}

export function fmtDateTime(v: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return toDate(v).toLocaleString("en-GB", { timeZone: APP_TZ, ...opts });
}

/** MM/YYYY from a month (1-12) + year — e.g. a Companies House DOB. Blank when
 *  neither is given. */
export function fmtMonthYear(month: number | null | undefined, year: number | null | undefined): string {
  if (!month && !year) return "";
  const mm = month ? String(month).padStart(2, "0") : "??";
  return `${mm}/${year ?? "????"}`;
}

/** Whole years + months between a date and now, e.g. "8 years, 7 months". */
export function durationSince(v: string | Date | null | undefined): string {
  if (!v) return "";
  const then = toDate(v);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  let months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) months -= 1;
  if (months < 0) return "";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} year${y === 1 ? "" : "s"}` : "", m ? `${m} month${m === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") || "0 months";
}
