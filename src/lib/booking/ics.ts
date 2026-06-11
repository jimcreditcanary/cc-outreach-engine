// Minimal iCalendar METHOD:REQUEST generator for booking invites. Used on
// the Google / no-write-scope path where we can't insert the event into the
// operator's calendar directly: both parties get an emailed .ics that
// Gmail / Outlook / Apple Mail render as a normal Yes/Maybe/No invite.

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 wants lines folded at 75 octets; we fold at 73 chars which is
 *  safe for the ASCII-ish content we emit. */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += 72) {
    chunks.push((i === 0 ? "" : " ") + line.slice(i, i + 72));
  }
  return chunks.join("\r\n");
}

export interface InviteOptions {
  uid: string;
  start: Date;
  end: Date;
  subject: string;
  description: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  location?: string | null;
}

export function buildInviteIcs(o: InviteOptions): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Credit Canary//Booking//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${o.uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(o.start)}`,
    `DTEND:${utcStamp(o.end)}`,
    `SUMMARY:${escapeText(o.subject)}`,
    `DESCRIPTION:${escapeText(o.description)}`,
    ...(o.location ? [`LOCATION:${escapeText(o.location)}`] : []),
    `ORGANIZER;CN=${escapeText(o.organizerName)}:mailto:${o.organizerEmail}`,
    `ATTENDEE;CN=${escapeText(o.organizerName)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${o.organizerEmail}`,
    `ATTENDEE;CN=${escapeText(o.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${o.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
