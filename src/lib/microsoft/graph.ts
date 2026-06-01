// Microsoft Graph API client — minimal, just what we need for calendar sync.

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface GraphAttendee {
  emailAddress: { name?: string; address?: string };
  status?: { response?: string };
  type?: string;
}

export interface GraphEvent {
  id: string;
  subject: string | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string };
  bodyPreview?: string;
  attendees?: GraphAttendee[];
  organizer?: { emailAddress: { address?: string; name?: string } };
  isCancelled?: boolean;
}

/** Pull events from `windowStart` to `windowEnd` (UTC ISO). Caps at 250. */
export async function listEvents(accessToken: string, windowStart: string, windowEnd: string): Promise<GraphEvent[]> {
  const params = new URLSearchParams({
    startDateTime: windowStart,
    endDateTime: windowEnd,
    $orderby: "start/dateTime",
    $top: "250",
    $select: "id,subject,start,end,location,onlineMeeting,bodyPreview,attendees,organizer,isCancelled",
  });
  const res = await fetch(`${GRAPH}/me/calendarView?${params}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph calendarView failed (${res.status}): ${t}`);
  }
  const data = (await res.json()) as { value: GraphEvent[] };
  return data.value;
}
