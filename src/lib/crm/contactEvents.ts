// Surface the events object on a contact page (feedback item 11). Events are
// keyed to the Supabase contacts.id (uuid), while the live CRM uses HubSpot
// contact ids (text). There's no shared key, so we bridge by email:
//   HubSpot contact.email → contacts.email → contacts.id → events.contact_id
// Returns [] gracefully when the contact has no email or no Supabase match.

import type { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;

export interface ContactEvent {
  type: string;
  ts: string;
  message: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  crm_change: "Change", email_sent: "Email sent", content_sent: "Content sent",
  click: "Clicked", open: "Opened", reply: "Reply", bounce: "Bounced",
  complaint: "Complaint", linkedin_note: "LinkedIn", press: "Press",
  lead: "Lead", snooze: "Snoozed", promote: "Promoted",
};
export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

export async function loadContactEventsByEmail(db: DB, email: string | null | undefined, limit = 40): Promise<ContactEvent[]> {
  const e = (email ?? "").trim();
  if (!e) return [];
  try {
    const { data: cRows } = await db.from("contacts").select("id").ilike("email", e).limit(1);
    const cid = (cRows as { id: string }[] | null)?.[0]?.id;
    if (!cid) return [];
    const { data } = await db
      .from("events")
      .select("type, ts, payload")
      .eq("contact_id", cid)
      .order("ts", { ascending: false })
      .limit(limit);
    return ((data as { type: string; ts: string; payload: Record<string, unknown> | null }[] | null) ?? []).map((ev) => {
      const p = ev.payload ?? {};
      const message = typeof p.message === "string" ? p.message
        : typeof p.subject === "string" ? p.subject
        : typeof p.title === "string" ? p.title : null;
      return { type: ev.type, ts: ev.ts, message };
    });
  } catch {
    return [];
  }
}
