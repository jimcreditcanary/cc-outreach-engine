"use server";

// PUBLIC inbound-lead capture — unauthenticated, everything untrusted.
// A submission becomes, in order:
//   1. a contact (matched by email, never duplicated; org linked on exact
//      name match only — anonymous input doesn't get to create companies)
//   2. a timeline event (type crm_change — payload-driven, so no enum
//      migration needed; renders as the message in the contact timeline)
//   3. an /alerts row (kind "inbound") — the in-app triage surface
//   4. a notification email to the inbound owner with CRM links
// The visitor lands on a thank-you state that offers the owner's booking
// page when one is configured — enquiry → meeting in one sitting.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { sendTransactional } from "@/lib/send/postmark";

type DB = ReturnType<typeof serviceClient>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Who fields inbound leads: INBOUND_LEAD_EMAIL env wins, else the
 *  workspace reply-to. Mapped back to an operator id (for ownership) and
 *  their booking slug (for the thank-you CTA) via user_settings. */
async function resolveInboundOwner(db: DB): Promise<{ ownerId: string | null; notifyEmail: string; bookingSlug: string | null }> {
  const notifyEmail = process.env.INBOUND_LEAD_EMAIL ?? process.env.POSTMARK_REPLY_TO ?? "jimfell@creditcanary.co.uk";
  let rows: { user_id: string; reply_to_email: string | null; booking_slug?: string | null }[] = [];
  const withSlug = await db.from("user_settings").select("user_id, reply_to_email, booking_slug").not("reply_to_email", "is", null);
  if (withSlug.error) {
    // Migration 035 (booking_slug) not applied yet — owner mapping still works.
    const bare = await db.from("user_settings").select("user_id, reply_to_email").not("reply_to_email", "is", null);
    rows = (bare.data ?? []) as typeof rows;
  } else {
    rows = (withSlug.data ?? []) as typeof rows;
  }
  const hit = rows.find((r) => (r.reply_to_email ?? "").toLowerCase() === notifyEmail.toLowerCase());
  return { ownerId: hit?.user_id ?? null, notifyEmail, bookingSlug: hit?.booking_slug ?? null };
}

export async function submitEnquiryAction(formData: FormData) {
  const src = String(formData.get("src") ?? "").slice(0, 60);
  const embed = String(formData.get("embed") ?? "") === "1";
  const back = (q: string) =>
    redirect(`/enquire?${q}${src ? `&src=${encodeURIComponent(src)}` : ""}${embed ? "&embed=1" : ""}`);

  // Honeypot — fake success for bots.
  if (String(formData.get("website") ?? "") !== "") back("sent=1");

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const company = String(formData.get("company") ?? "").trim().slice(0, 120) || null;
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000) || null;
  if (!name) back(`error=${encodeURIComponent("Please enter your name.")}`);
  if (!EMAIL_RE.test(email)) back(`error=${encodeURIComponent("That email address doesn't look right.")}`);

  const db = serviceClient();
  const { ownerId, notifyEmail, bookingSlug } = await resolveInboundOwner(db);

  // ── Contact: match by email, never duplicate ──────────────────────
  const { data: existing } = await db.from("contacts").select("id, organisation_id").ilike("email", email).maybeSingle();
  let organisationId: string | null = existing?.organisation_id ?? null;
  if (!organisationId && company) {
    const { data: org } = await db.from("organisations").select("id").ilike("name", company).maybeSingle();
    organisationId = (org?.id as string | undefined) ?? null;
  }
  let contactId: string;
  if (existing) {
    contactId = existing.id as string;
    if (organisationId && !existing.organisation_id) {
      await db.from("contacts").update({ organisation_id: organisationId }).eq("id", contactId);
    }
  } else {
    const { data: inserted, error: cErr } = await db
      .from("contacts")
      .insert({ full_name: name, email, organisation_id: organisationId, owner_id: ownerId })
      .select("id")
      .single();
    if (cErr || !inserted) back(`error=${encodeURIComponent("Couldn't save your details — please try again.")}`);
    contactId = inserted!.id as string;
  }

  // ── Timeline event + alert (best-effort: the contact is already in) ──
  const summary = message ?? "(no message left)";
  await db
    .from("events")
    .insert({
      contact_id: contactId,
      organisation_id: organisationId,
      type: "crm_change",
      owner_id: ownerId,
      payload: {
        kind: "inbound_lead",
        message: `📥 Inbound enquiry${src ? ` (via ${src})` : ""}: ${summary}`,
        company,
        source: src || "landing-page",
      },
    })
    .then(({ error }) => error && console.error("enquire event:", error.message));
  await db
    .from("alerts")
    .insert({
      contact_id: contactId,
      organisation_id: organisationId,
      owner_id: ownerId,
      kind: "inbound",
      title: `Inbound lead: ${name}${company ? ` — ${company}` : ""}${existing ? " (existing contact)" : ""}`,
      summary: summary.slice(0, 500),
      source: src || "landing-page",
    })
    .then(({ error }) => error && console.error("enquire alert:", error.message));

  // ── Notify the inbound owner ──────────────────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  const lines = [
    `${name} <${email}>${existing ? " — already in the CRM" : " — new contact created"}`,
    company ? `Company: ${company}${organisationId ? " (matched)" : " (no CRM match)"}` : null,
    src ? `Source: ${src}` : null,
    message ? `Message: ${message}` : "No message left.",
    `Contact: ${appUrl}/contacts/${contactId}`,
    `Triage: ${appUrl}/alerts`,
  ].filter(Boolean);
  await sendTransactional({
    to: notifyEmail,
    subject: `📥 Inbound lead: ${name}${company ? ` (${company})` : ""}`,
    textBody: lines.join("\n"),
    htmlBody: `<p>${lines.join("<br/>")}</p>`,
    ownerId,
    tag: "inbound-lead",
  }).catch(() => {});

  back(`sent=1${bookingSlug ? `&book=${encodeURIComponent(bookingSlug)}` : ""}`);
}
