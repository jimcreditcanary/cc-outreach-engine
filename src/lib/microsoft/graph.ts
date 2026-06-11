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
  /** free | tentative | busy | oof | workingElsewhere */
  showAs?: string;
}

/** Pull events from `windowStart` to `windowEnd` (UTC ISO). Caps at 250. */
export async function listEvents(accessToken: string, windowStart: string, windowEnd: string): Promise<GraphEvent[]> {
  const params = new URLSearchParams({
    startDateTime: windowStart,
    endDateTime: windowEnd,
    $orderby: "start/dateTime",
    $top: "250",
    $select: "id,subject,start,end,location,onlineMeeting,bodyPreview,attendees,organizer,isCancelled,showAs",
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

export interface CreateEventInput {
  subject: string;
  /** UTC ISO instants */
  startUtc: string;
  endUtc: string;
  attendees: { name?: string | null; address: string }[];
  bodyText?: string;
  /** Ask Outlook to attach a Teams meeting. Retried without if the tenant
   *  isn't licensed for it. */
  onlineMeeting?: boolean;
}

/** Create an event in the operator's calendar. Outlook sends the invite
 *  email to attendees itself. Needs Calendars.ReadWrite — tokens granted
 *  before that scope was requested get a 403 ("ErrorAccessDenied"); the
 *  caller falls back to the emailed-ICS path. */
export async function createEvent(accessToken: string, input: CreateEventInput): Promise<{ id: string; joinUrl: string | null }> {
  const body = (withTeams: boolean) => ({
    subject: input.subject,
    start: { dateTime: input.startUtc, timeZone: "UTC" },
    end: { dateTime: input.endUtc, timeZone: "UTC" },
    attendees: input.attendees.map((a) => ({
      emailAddress: { address: a.address, name: a.name ?? a.address },
      type: "required",
    })),
    ...(input.bodyText ? { body: { contentType: "text", content: input.bodyText } } : {}),
    ...(withTeams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  });

  const post = async (withTeams: boolean) =>
    fetch(`${GRAPH}/me/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body(withTeams)),
    });

  let res = await post(input.onlineMeeting ?? true);
  // 403 = scope problem, let it surface. Other 4xx with Teams requested is
  // usually the online-meeting provider — retry plain.
  if (!res.ok && res.status !== 403 && (input.onlineMeeting ?? true)) {
    res = await post(false);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph createEvent failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: string; onlineMeeting?: { joinUrl?: string } };
  return { id: data.id, joinUrl: data.onlineMeeting?.joinUrl ?? null };
}
