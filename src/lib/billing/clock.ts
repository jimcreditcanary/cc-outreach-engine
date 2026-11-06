// Billing clock — all billing boundaries (the 1st-of-month run, the 15th chase,
// "today" for overdue) are in Europe/London, not UTC, so they land on the right
// UK calendar day across BST/GMT (X4). Day-COUNT maths (days in month, pro-rata)
// is calendar-based and timezone-independent; this is only about which UK day
// "now" is. Vercel crons fire in UTC, so the cron's scheduled hour is UTC — the
// London date is what we compute the period/overdue from here.

/** Today's date in Europe/London as "YYYY-MM-DD". */
export function londonToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; the timeZone shifts the civil date to London.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The 1st of the current month in Europe/London as "YYYY-MM-01". */
export function londonFirstOfThisMonth(now: Date = new Date()): string {
  return `${londonToday(now).slice(0, 7)}-01`;
}
