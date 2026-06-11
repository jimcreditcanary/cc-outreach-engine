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
