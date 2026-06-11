// Calendar sync: pull events from Microsoft Graph, upsert into meetings,
// match attendee emails to contacts, and infer the org / deal context so
// the meeting lands linked to the rest of the CRM.
//
// Linking rules (matter — used to be buggy):
//   - Skip team operators when picking the primary external contact.
//     Otherwise Jim (who's also a contact row) gets picked as the
//     "primary" of every meeting he attends.
//   - Never overwrite a manual link. If the meeting already has an
//     organisation_id / primary_contact_id / deal_id set, preserve it.
//     The sync runs hourly; the operator shouldn't have to keep
//     re-picking the company.
//   - Prefer an OPEN deal on the matched org. If multiple are open,
//     pick the most recently updated.

import { serviceClient } from "../db/client";
import { getValidAccessToken } from "../microsoft/oauth";
import { listEvents, type GraphAttendee } from "../microsoft/graph";

type DB = ReturnType<typeof serviceClient>;

export interface SyncResult {
  ok: boolean;
  reason?: string;
  fetched: number;
  upserted: number;
  linked_to_contact: number;
}

export interface StoredAttendee {
  name: string | null;
  email: string | null;
  response: string | null;
  contact_id: string | null;
}

export interface ExistingLinks {
  organisation_id: string | null;
  primary_contact_id: string | null;
  deal_id: string | null;
}

/** Collect every email that belongs to a team operator (so the inference
 *  step can skip them when picking the primary external attendee). */
export async function loadTeamEmails(db: DB): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { adminClient } = await import("../auth/admin");
    const { data } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 100 });
    for (const u of data?.users ?? []) if (u.email) out.add(u.email.toLowerCase());
  } catch { /* best-effort */ }
  const { data: settings } = await db.from("user_settings").select("reply_to_email, from_email");
  for (const s of (settings ?? []) as { reply_to_email: string | null; from_email: string | null }[]) {
    if (s.reply_to_email) out.add(s.reply_to_email.toLowerCase());
    const m = (s.from_email ?? "").match(/<([^>]+)>/);
    const fromAddr = (m?.[1] ?? s.from_email ?? "").trim().toLowerCase();
    if (fromAddr.includes("@")) out.add(fromAddr);
  }
  return out;
}

export interface LinkContext {
  byEmail: Map<string, { id: string; organisation_id: string | null }>;
  openDealByOrg: Map<string, string>;
  teamEmails: Set<string>;
}

/** Preload everything inferMeetingLinks needs: contacts indexed by lowercase
 *  email, latest open deal per org, and the team-operator email set. Shared
 *  by the Outlook sync, the Google Calendar sync, and the backfill. */
export async function loadLinkContext(db: DB): Promise<LinkContext> {
  const { data: contactRows } = await db.from("contacts").select("id, email, organisation_id").not("email", "is", null);
  const byEmail = new Map<string, { id: string; organisation_id: string | null }>();
  for (const c of contactRows ?? []) {
    byEmail.set(String(c.email).toLowerCase(), { id: c.id as string, organisation_id: c.organisation_id as string | null });
  }

  // Latest open deal per org so we can default the meeting's deal_id.
  // Most recently updated wins on ties (more likely the "current" deal).
  const { data: openDeals } = await db
    .from("deals")
    .select("id, organisation_id, updated_at")
    .eq("status", "open")
    .order("updated_at", { ascending: false });
  const openDealByOrg = new Map<string, string>();
  for (const d of openDeals ?? []) {
    if (d.organisation_id && !openDealByOrg.has(d.organisation_id as string)) {
      openDealByOrg.set(d.organisation_id as string, d.id as string);
    }
  }

  const teamEmails = await loadTeamEmails(db);
  return { byEmail, openDealByOrg, teamEmails };
}

/** Infer (organisation_id, primary_contact_id, deal_id) from a meeting's
 *  attendees. Exported so the backfill script can reuse it. */
export function inferMeetingLinks(opts: {
  attendees: StoredAttendee[];
  byEmail: Map<string, { id: string; organisation_id: string | null }>;
  openDealByOrg: Map<string, string>;
  teamEmails: Set<string>;
  /** When set, returned values are merged with these (existing wins).
   *  Use to preserve operator-set picks during re-sync. */
  existing?: ExistingLinks | null;
}): ExistingLinks {
  const externalMatched = opts.attendees.find((a) => {
    if (!a.contact_id || !a.email) return false;
    return !opts.teamEmails.has(a.email.toLowerCase());
  });
  // Fall back to ANY matched attendee (including team) if no external
  // match found — better than nothing for internal-only meetings.
  const fallback = opts.attendees.find((a) => !!a.contact_id);
  const primary = externalMatched ?? fallback ?? null;

  const inferredContact = primary?.contact_id ?? null;
  const inferredOrg = primary
    ? opts.byEmail.get((primary.email ?? "").toLowerCase())?.organisation_id ?? null
    : null;
  const inferredDeal = inferredOrg ? opts.openDealByOrg.get(inferredOrg) ?? null : null;

  // Existing values win — operator manual picks are sticky.
  const e = opts.existing ?? null;
  return {
    organisation_id: e?.organisation_id ?? inferredOrg,
    primary_contact_id: e?.primary_contact_id ?? inferredContact,
    deal_id: e?.deal_id ?? inferredDeal,
  };
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

  const { byEmail, openDealByOrg, teamEmails } = await loadLinkContext(db);

  // Pre-fetch existing links so we don't clobber operator manual picks
  // every sync tick. One batched query keyed on ms_event_id.
  const ids = events.map((e) => e.id).filter(Boolean);
  const existingByMsId = new Map<string, ExistingLinks>();
  if (ids.length > 0) {
    const { data: existing } = await db
      .from("meetings")
      .select("ms_event_id, organisation_id, primary_contact_id, deal_id")
      .in("ms_event_id", ids);
    for (const m of existing ?? []) {
      existingByMsId.set(m.ms_event_id as string, {
        organisation_id: (m.organisation_id as string | null) ?? null,
        primary_contact_id: (m.primary_contact_id as string | null) ?? null,
        deal_id: (m.deal_id as string | null) ?? null,
      });
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

    const links = inferMeetingLinks({
      attendees,
      byEmail,
      openDealByOrg,
      teamEmails,
      existing: existingByMsId.get(e.id) ?? null,
    });
    if (links.primary_contact_id) linkedToContact++;

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
        organisation_id: links.organisation_id,
        primary_contact_id: links.primary_contact_id,
        deal_id: links.deal_id,
        // Tag the meeting with whose calendar it came from. Microsoft event
        // IDs are mailbox-unique, so if two operators are both invited to
        // the same meeting they each get their own row (one per calendar
        // copy) — which is what we want: each sees their own.
        owner_id: userId,
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

/** Backfill: re-run inference over meetings whose links are still null.
 *  Doesn't touch meetings that already have an operator-set link. */
export async function backfillMeetingLinks(db: DB): Promise<{ scanned: number; updated: number; errors: string[] }> {
  const result = { scanned: 0, updated: 0, errors: [] as string[] };

  const { byEmail, openDealByOrg, teamEmails } = await loadLinkContext(db);

  const { data: rows, error } = await db
    .from("meetings")
    .select("id, attendees, organisation_id, primary_contact_id, deal_id")
    .or("organisation_id.is.null,primary_contact_id.is.null,deal_id.is.null")
    .limit(5000);
  if (error) { result.errors.push(`load: ${error.message}`); return result; }

  for (const m of rows ?? []) {
    result.scanned++;
    const attendees = ((m.attendees ?? []) as StoredAttendee[]) ?? [];
    const inferred = inferMeetingLinks({
      attendees,
      byEmail,
      openDealByOrg,
      teamEmails,
      existing: {
        organisation_id: (m.organisation_id as string | null) ?? null,
        primary_contact_id: (m.primary_contact_id as string | null) ?? null,
        deal_id: (m.deal_id as string | null) ?? null,
      },
    });
    // Only write if something actually changed.
    const changed =
      inferred.organisation_id !== (m.organisation_id ?? null) ||
      inferred.primary_contact_id !== (m.primary_contact_id ?? null) ||
      inferred.deal_id !== (m.deal_id ?? null);
    if (!changed) continue;
    const { error: updErr } = await db.from("meetings").update(inferred).eq("id", m.id);
    if (updErr) { result.errors.push(`${m.id}: ${updErr.message}`); continue; }
    result.updated++;
  }

  return result;
}
