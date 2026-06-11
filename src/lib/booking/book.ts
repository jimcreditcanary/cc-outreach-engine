// Booking engine for the public /book/<slug> pages. One entry point,
// createBooking(), called by the (unauthenticated) server action:
//
//   1. resolve slug → operator + page config
//   2. re-validate the requested slot server-side (working hours, min
//      notice, busy calendars, existing meetings) — the client's slot list
//      is advisory only
//   3. match-or-create the contact (email is the identity key, same rule
//      as Add-to-CRM on meetings)
//   4. insert the meetings row (this instantly blocks the slot for any
//      concurrent visitor — the meetings table is a busy source)
//   5. put it on the operator's calendar: Graph createEvent when we hold a
//      write-scoped Outlook token (Outlook then emails the visitor's invite
//      itself), otherwise emailed .ics invites to both parties via Postmark
//   6. notify the operator
//
// Nothing here trusts the visitor: slot membership is recomputed, email is
// shape-checked, and free-text lands in plain-text emails / DB columns only.

import { serviceClient } from "../db/client";
import { resolveSender } from "../generate/sender";
import { getValidAccessToken } from "../microsoft/oauth";
import { createEvent } from "../microsoft/graph";
import { sendTransactional } from "../send/postmark";
import { computeSlots, type BookingConfig } from "./availability";
import { loadBusyIntervals } from "./busy";
import { buildInviteIcs } from "./ics";

type DB = ReturnType<typeof serviceClient>;

export const BOOKING_HORIZON_DAYS = 21;

export interface BookingPage {
  user_id: string;
  operator_name: string;
  config: BookingConfig;
  title_template: string;
}

interface SettingsRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  booking_slug: string | null;
  booking_duration_mins: number;
  booking_buffer_mins: number;
  booking_day_start: string;
  booking_day_end: string;
  booking_days: string[] | null;
  booking_tz: string;
  booking_title_template: string | null;
  booking_min_notice_hours: number;
}

const SETTINGS_COLS =
  "user_id, first_name, last_name, booking_slug, booking_duration_mins, booking_buffer_mins, booking_day_start, booking_day_end, booking_days, booking_tz, booking_title_template, booking_min_notice_hours";

function toPage(s: SettingsRow): BookingPage {
  const name = [s.first_name, s.last_name].filter(Boolean).join(" ") || "Credit Canary";
  return {
    user_id: s.user_id,
    operator_name: name,
    title_template: s.booking_title_template || "{operator} × {visitor}",
    config: {
      durationMins: s.booking_duration_mins,
      bufferMins: s.booking_buffer_mins,
      dayStart: s.booking_day_start,
      dayEnd: s.booking_day_end,
      days: s.booking_days ?? ["mon", "tue", "wed", "thu", "fri"],
      tz: s.booking_tz,
      minNoticeHours: s.booking_min_notice_hours,
      horizonDays: BOOKING_HORIZON_DAYS,
    },
  };
}

export async function loadBookingPage(db: DB, slug: string): Promise<BookingPage | null> {
  const { data } = await db.from("user_settings").select(SETTINGS_COLS).eq("booking_slug", slug).maybeSingle();
  return data ? toPage(data as unknown as SettingsRow) : null;
}

/** Slots for the public page (and for server-side re-validation). */
export async function availableSlots(db: DB, page: BookingPage, now = new Date()): Promise<Date[]> {
  const to = new Date(now.getTime() + (BOOKING_HORIZON_DAYS + 1) * 86_400_000);
  const busy = await loadBusyIntervals(db, page.user_id, now, to);
  return computeSlots(page.config, busy, now);
}

export interface BookingRequest {
  slug: string;
  slotIso: string;
  name: string;
  email: string;
  company?: string | null;
  note?: string | null;
}

export interface BookingResult {
  ok: boolean;
  error?: string;
  start?: Date;
  end?: Date;
  operatorName?: string;
  joinUrl?: string | null;
  /** "outlook" = event written to the calendar (Outlook emails the invite);
   *  "email_invite" = .ics invites emailed to both parties. */
  method?: "outlook" | "email_invite";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createBooking(db: DB, req: BookingRequest): Promise<BookingResult> {
  const page = await loadBookingPage(db, req.slug);
  if (!page) return { ok: false, error: "This booking page doesn't exist." };

  const name = req.name.trim().slice(0, 120);
  const email = req.email.trim().toLowerCase();
  if (!name) return { ok: false, error: "Please enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look right." };

  const start = new Date(req.slotIso);
  if (!isFinite(start.getTime())) return { ok: false, error: "Pick a time slot first." };
  const end = new Date(start.getTime() + page.config.durationMins * 60_000);

  // Server-side re-validation — covers tampering AND slots that filled up
  // while the visitor had the page open.
  const slots = await availableSlots(db, page);
  if (!slots.some((s) => s.getTime() === start.getTime())) {
    return { ok: false, error: "That slot is no longer available — please pick another." };
  }

  // ── Contact: match by email, never duplicate ──────────────────────
  const { data: existing } = await db
    .from("contacts")
    .select("id, organisation_id")
    .ilike("email", email)
    .maybeSingle();
  let contactId: string;
  let organisationId: string | null = existing?.organisation_id ?? null;
  if (existing) {
    contactId = existing.id as string;
  } else {
    // Company: link an existing org on exact-ish name match only. Creating
    // orgs from anonymous form input would pollute the CRM.
    const companyName = req.company?.trim() || null;
    if (companyName) {
      const { data: org } = await db.from("organisations").select("id").ilike("name", companyName).maybeSingle();
      organisationId = (org?.id as string | undefined) ?? null;
    }
    const { data: inserted, error: cErr } = await db
      .from("contacts")
      .insert({ full_name: name, email, organisation_id: organisationId, owner_id: page.user_id })
      .select("id")
      .single();
    if (cErr || !inserted) return { ok: false, error: "Couldn't save your details — please try again." };
    contactId = inserted.id as string;
  }

  // ── Meeting row (this is what blocks the slot for everyone else) ──
  const sender = await resolveSender(db, page.user_id);
  const subject = page.title_template
    .replace("{operator}", page.operator_name)
    .replace("{visitor}", name);
  const noteLines = [
    "Booked via the public booking page.",
    req.company?.trim() ? `Company (as entered): ${req.company.trim()}` : null,
    req.note?.trim() ? `Note from ${name}: ${req.note.trim().slice(0, 2000)}` : null,
  ].filter(Boolean);

  const { data: mtg, error: mErr } = await db
    .from("meetings")
    .insert({
      subject,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      attendees: [
        { name: page.operator_name, email: sender.reply_to_email, response: "accepted", contact_id: null },
        { name, email, response: "accepted", contact_id: contactId },
      ],
      primary_contact_id: contactId,
      organisation_id: organisationId,
      owner_id: page.user_id,
      booked_via: "booking_page",
      notes: noteLines.join("\n"),
      sales_relevant: true,
      status: "upcoming",
    })
    .select("id")
    .single();
  if (mErr || !mtg) return { ok: false, error: "Couldn't confirm the booking — please try again." };
  const meetingId = mtg.id as string;

  // ── Calendar: Graph write first, emailed invite as fallback ───────
  let method: BookingResult["method"] = "email_invite";
  let joinUrl: string | null = null;
  const accessToken = await getValidAccessToken(db, page.user_id).catch(() => null);
  if (accessToken) {
    try {
      const ev = await createEvent(accessToken, {
        subject,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        attendees: [{ name, address: email }],
        bodyText: noteLines.join("\n"),
        onlineMeeting: true,
      });
      await db.from("meetings").update({ ms_event_id: ev.id, online_url: ev.joinUrl }).eq("id", meetingId);
      method = "outlook";
      joinUrl = ev.joinUrl;
    } catch {
      // Read-only token (pre-ReadWrite consent) or Graph hiccup — the
      // emailed-ICS path below covers both parties.
    }
  }

  // Emails state the time in the OPERATOR's booking timezone with the zone
  // name spelled out ("Thu, 12 Jun 2026, 09:00 BST") — never raw UTC, which
  // reads an hour off for the whole of British Summer Time.
  const whenText = start.toLocaleString("en-GB", {
    timeZone: page.config.tz,
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  if (method === "email_invite") {
    const ics = buildInviteIcs({
      uid: `booking-${meetingId}@veepveep.co.uk`,
      start,
      end,
      subject,
      description: noteLines.join("\n"),
      organizerName: page.operator_name,
      organizerEmail: sender.reply_to_email,
      attendeeName: name,
      attendeeEmail: email,
    });
    // Visitor's invite — from the operator's sender identity.
    await sendTransactional({
      to: email,
      subject: `Confirmed: ${subject}`,
      textBody: `Hi ${name.split(" ")[0]},\n\nYou're booked in with ${page.operator_name} (${whenText}, ${page.config.durationMins} min). The attached invite adds it to your calendar.\n\nSpeak soon,\n${page.operator_name}`,
      htmlBody: `<p>Hi ${name.split(" ")[0]},</p><p>You're booked in with ${page.operator_name} (${whenText}, ${page.config.durationMins} min). The attached invite adds it to your calendar.</p><p>Speak soon,<br/>${page.operator_name}</p>`,
      ownerId: page.user_id,
      ics: { filename: "invite.ics", content: ics },
      tag: "booking-invite",
    }).catch(() => {});
  }

  // ── Operator notification (carries the invite on the email path so a
  //    Google-calendar operator can accept it straight onto their calendar)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  const detail = [
    `${name} <${email}>`,
    req.company?.trim() ? `Company: ${req.company.trim()}` : null,
    `When: ${whenText} (${page.config.durationMins} min)`,
    req.note?.trim() ? `Note: ${req.note.trim().slice(0, 2000)}` : null,
    `Meeting: ${appUrl}/meetings/${meetingId}`,
    `Contact: ${appUrl}/contacts/${contactId}`,
    method === "outlook"
      ? "Added to your Outlook calendar (invite sent to them by Outlook)."
      : "Calendar invite attached — accept it to add to your calendar. (Connect Outlook with the new permissions and future bookings land in your calendar automatically.)",
  ].filter(Boolean);
  await sendTransactional({
    to: sender.reply_to_email,
    subject: `📅 New booking: ${name} — ${whenText}`,
    textBody: detail.join("\n"),
    htmlBody: `<p>${detail.join("<br/>")}</p>`,
    ownerId: page.user_id,
    ...(method === "email_invite"
      ? {
          ics: {
            filename: "invite.ics",
            content: buildInviteIcs({
              uid: `booking-${meetingId}@veepveep.co.uk`,
              start,
              end,
              subject,
              description: noteLines.join("\n"),
              organizerName: page.operator_name,
              organizerEmail: sender.reply_to_email,
              attendeeName: name,
              attendeeEmail: email,
            }),
          },
        }
      : {}),
    tag: "booking-notification",
  }).catch(() => {});

  return { ok: true, start, end, operatorName: page.operator_name, joinUrl, method };
}
