// Calendar sync: pull events from Microsoft Graph, upsert into meetings,
// match attendee emails to contacts, and infer the org/deal context so the
// meeting lands linked to the rest of the CRM.

import { serviceClient } from "../db/client";
import { getValidAccessToken } from "../microsoft/oauth";
import { listEvents, type GraphAttendee, type GraphEvent } from "../microsoft/graph";

type DB = ReturnType<typeof serviceClient>;

export interface SyncResult {
  ok: boolean;
  reason?: string;
  fetched: number;
  upserted: number;
  linked_to_contact: number;
}

interface StoredAttendee {
  name: string | null;
  email: string | null;
  response: string | null;
  contact_id: string | null;
}

/** Pull next 14 days + previous 1 day of events for the operator's calendar. */
export async function syncCalendar(db: DB, userId: string): Promise<SyncResult> {
  const accessToken = await getValidAccessToken(db, userId);
  if (!accessToken) {
    return { ok: false, reason: "Microsoft account not connected — visit /meetings → Connect", fetched: 0, upserted: 0, linked_to_contact: 0 };
  }

  const now = new Date();
  const start = new Date(now.getTime() - 1 * 86_400_000).toISOString();
  const end = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const events = await listEvents(accessToken, start, end);

  // Preload contacts indexed by lowercase email so attendee matching is O(1).
  const { data: contactRows } = await db.from("contacts").select("id, email, organisation_id").not("email", "is", null);
  const byEmail = new Map<string, { id: string; organisation_id: string | null }>();
  for (const c of contactRows ?? []) {
    byEmail.set(String(c.email).toLowerCase(), { id: c.id as string, organisation_id: c.organisation_id as string | null });
  }

  // Preload latest open deal per org so we can default the meeting's deal_id.
  const { data: openDeals } = await db.from("deals").select("id, organisation_id").eq("status", "open");
  const openDealByOrg = new Map<string, string>();
  for (const d of openDeals ?? []) {
    if (d.organisation_id && !openDealByOrg.has(d.organisation_id as string)) {
      openDealByOrg.set(d.organisation_id as string, d.id as string);
    }
  }

  let upserted = 0;
  let linkedToContact = 0;

  for (const e of events) {
    if (e.isCancelled) continue;

    const attendees: StoredAttendee[] = (e.attendees ?? []).map((a: GraphAttendee) => {
      const email = a.emailAddress?.address?.toLowerCase() ?? null;
      const hit = email ? byEmail.get(email) : undefined;
      return {
        name: a.emailAddress?.name ?? null,
        email: a.emailAddress?.address ?? null,
        response: a.status?.response ?? null,
        contact_id: hit?.id ?? null,
      };
    });

    // First matched attendee drives org/deal linkage. Organiser doesn't count
    // (that's usually Jim); prefer external attendees.
    const matched = attendees.find((a) => a.contact_id);
    const organisation_id = matched ? byEmail.get((matched.email ?? "").toLowerCase())?.organisation_id ?? null : null;
    const primary_contact_id = matched?.contact_id ?? null;
    const deal_id = organisation_id ? openDealByOrg.get(organisation_id) ?? null : null;
    if (primary_contact_id) linkedToContact++;

    const isPast = new Date(e.end.dateTime).getTime() < Date.now();

    const { error } = await db.from("meetings").upsert(
      {
        ms_event_id: e.id,
        subject: e.subject,
        start_at: e.start.dateTime,
        end_at: e.end.dateTime,
        location: e.location?.displayName ?? null,
        online_url: e.onlineMeeting?.joinUrl ?? null,
        body_preview: e.bodyPreview ?? null,
        attendees,
        organisation_id,
        primary_contact_id,
        deal_id,
        status: isPast ? "done" : "upcoming",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ms_event_id" },
    );
    if (error) throw error;
    upserted++;
  }

  return { ok: true, fetched: events.length, upserted, linked_to_contact: linkedToContact };
}
