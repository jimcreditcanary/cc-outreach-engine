// Per-operator meeting visibility. A meeting is yours to see when:
//   1. it came off one of YOUR connected calendars (owner_id = you), or
//   2. your email is on the attendee list (you were invited; the row was
//      synced from a teammate's calendar), or
//   3. it predates owner stamping (owner_id null — legacy rows only).
// Used by /meetings and /meetings/[id]. Contact + company timelines stay
// shared: knowing a meeting happened is CRM context for the whole team;
// opening it is not.

export interface VisibleMeeting {
  owner_id: string | null;
  attendees: unknown;
}

/** Every email address that identifies an operator: their login email plus
 *  the reply-to / from addresses configured in /settings. Calendar invites
 *  can arrive on any of them. */
export function emailAliases(
  authEmail: string | null | undefined,
  settings?: { reply_to_email?: string | null; from_email?: string | null } | null,
): Set<string> {
  const out = new Set<string>();
  if (authEmail) out.add(authEmail.toLowerCase());
  if (settings?.reply_to_email) out.add(String(settings.reply_to_email).toLowerCase());
  // from_email is stored as "Name <addr>" — strip to the bare address.
  const m = String(settings?.from_email ?? "").match(/<([^>]+)>/);
  const fromAddr = (m?.[1] ?? settings?.from_email ?? "").trim().toLowerCase();
  if (fromAddr.includes("@")) out.add(fromAddr);
  return out;
}

export function canSeeMeeting(meeting: VisibleMeeting, userId: string, myEmails: Set<string>): boolean {
  if (!meeting.owner_id || meeting.owner_id === userId) return true;
  const attendees = (meeting.attendees ?? []) as { email?: string | null }[];
  return attendees.some((a) => a.email && myEmails.has(String(a.email).toLowerCase()));
}
