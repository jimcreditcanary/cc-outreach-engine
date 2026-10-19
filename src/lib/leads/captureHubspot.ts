// Lead capture against HubSpot (P3) — the HubSpot-backed twin of captureLead.
// Same contract (LeadInput → LeadResult) so the /api/leads route and /enquire
// form branch to it when CRM_BACKEND=hubspot, with the Supabase captureLead as
// the fallback until cutover.
//
// Writes that go to HubSpot: contact (matched by email, never duplicated;
// assigned to Jim Fell), its company association, and a Note timeline entry.
// Writes that stay in Supabase (operational): the /alerts triage row. The
// owner notification still goes via Postmark. The alert can't FK to a HubSpot
// id, so it carries the HubSpot record URL in `link` and leaves the id columns
// null.

import { serviceClient } from "../db/client";
import { sendTransactional } from "../send/postmark";
import { resolveInboundOwner, eventMessage, type LeadInput, type LeadResult } from "./capture";
import { recordUrl } from "../hubspot/client";
import { hubspotRepo, findContactByEmail, findCompanyByName, createCompany, addContactNote } from "../hubspot/repo";
import { enqueueInboundFollowup } from "../mailer/inbound";
import type { ContactWrite } from "../crm/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** All captured leads are assigned to Jim Fell (HubSpot owner 86510668),
 *  overridable via env for other workspaces. */
const LEAD_OWNER_ID = process.env.HUBSPOT_LEAD_OWNER_ID ?? "86510668";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function captureLeadHubspot(input: LeadInput): Promise<LeadResult> {
  const email = (input.email ?? "").trim().toLowerCase();
  const name = (input.name ?? "").trim().slice(0, 120) || email.split("@")[0] || email;
  const company = (input.company ?? "").trim().slice(0, 120) || null;
  if (!EMAIL_RE.test(email)) return { ok: false, error: "A valid email is required." };

  const db = serviceClient();
  const { ownerId, notifyEmail, bookingSlug } = await resolveInboundOwner(db);

  // ── Contact: match by email, never duplicate ──────────────────────
  const existing = await findContactByEmail(email);

  // ── Company: existing link → name match → create (if allowed) ─────
  let companyId: string | null = existing?.company_id ?? null;
  if (!companyId && company) {
    const found = await findCompanyByName(company);
    companyId = found?.id ?? null;
    if (!companyId && input.createCompany) {
      companyId = (await createCompany({ name: company, owner_id: LEAD_OWNER_ID })).id;
    }
  }

  let contactId: string;
  let createdContact = false;
  let isNewLead = false;

  if (existing) {
    contactId = existing.id;
    // Assign to Jim; link the company and stamp provenance without clobbering.
    const patch: ContactWrite = { owner_id: LEAD_OWNER_ID };
    if (companyId && !existing.company_id) patch.company_id = companyId;
    if (input.source && !existing.lead_source) patch.lead_source = input.source;
    if (input.mobile?.trim()) patch.mobile = input.mobile.trim();
    await hubspotRepo.updateContact(contactId, patch);
  } else {
    const created = await hubspotRepo.createContact({
      full_name: name,
      email,
      job_title: input.job_title?.trim() || null,
      mobile: input.mobile?.trim() || null,
      is_new: true,
      lead_source: input.source ?? input.kind,
      company_id: companyId,
      owner_id: LEAD_OWNER_ID,
    });
    contactId = created.id;
    createdContact = true;
    isNewLead = true;
  }

  const contactUrl = recordUrl("contacts", contactId);

  // ── Timeline Note (best-effort — needs notes write scope) ─────────
  await addContactNote(contactId, eventMessage(input));

  // ── Alert for triage (Supabase operational; points out to HubSpot) ─
  const today = new Date().toISOString().slice(0, 10);
  const dedupKey = input.kind === "download" && input.asset
    ? `download:hs:${contactId}:${slugify(input.asset)}:${today}`
    : null;
  const alertTitle =
    input.kind === "download"
      ? `Whitepaper download: ${name}${company ? ` — ${company}` : ""}${existing ? " (existing contact)" : ""}`
      : input.kind === "enquiry"
        ? `Inbound enquiry: ${name}${company ? ` — ${company}` : ""}${existing ? " (existing contact)" : ""}`
        : `New lead: ${name}${company ? ` — ${company}` : ""}${existing ? " (existing contact)" : ""}`;
  await db
    .from("alerts")
    .upsert(
      {
        contact_id: null,
        organisation_id: null,
        owner_id: ownerId,
        kind: input.kind === "enquiry" ? "inbound" : "lead",
        title: alertTitle,
        summary: (input.asset ? `${input.asset}. ` : "") + (input.message?.trim() ?? ""),
        link: contactUrl,
        source: input.source ?? input.kind,
        dedup_key: dedupKey,
      },
      dedupKey ? { onConflict: "dedup_key", ignoreDuplicates: true } : undefined,
    )
    .then(({ error }) => error && console.error("lead alert:", error.message));

  // ── Notify the owner (Postmark, unchanged) ────────────────────────
  if (input.notify !== false) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
    const lines = [
      `${name} <${email}>${createdContact ? " — new contact created" : " — already in the CRM"}`,
      input.job_title?.trim() ? `Job title: ${input.job_title.trim()}` : null,
      company ? `Company: ${company}${companyId ? " (linked)" : ""}` : null,
      input.mobile?.trim() ? `Mobile: ${input.mobile.trim()}` : null,
      input.asset ? `Resource: ${input.asset}` : null,
      input.source ? `Source: ${input.source}` : null,
      input.url ? `Page: ${input.url}` : null,
      input.message?.trim() ? `Message: ${input.message.trim()}` : null,
      `Contact (HubSpot): ${contactUrl}`,
      `Triage: ${appUrl}/alerts`,
    ].filter(Boolean);
    await sendTransactional({
      to: notifyEmail,
      subject:
        input.kind === "download"
          ? `📄 ${name}${company ? ` (${company})` : ""} downloaded ${input.asset ?? "a resource"}`
          : `📥 ${input.kind === "enquiry" ? "Inbound enquiry" : "New lead"}: ${name}${company ? ` (${company})` : ""}`,
      textBody: lines.join("\n"),
      htmlBody: `<p>${lines.join("<br/>")}</p>`,
      ownerId,
      tag: `lead-${input.kind}`,
    }).catch(() => {});
  }

  // Enqueue a personalised inbound follow-up (fast marker; drafted by the
  // inbound-followups job so the API stays snappy).
  await enqueueInboundFollowup(db, {
    hsContactId: contactId,
    kind: input.kind === "enquiry" ? "enquiry" : "download",
    asset: input.asset ?? null,
    page: input.url ?? null,
    ownerId,
  });

  return {
    ok: true,
    contact_id: contactId,
    organisation_id: companyId,
    created_contact: createdContact,
    is_new_lead: isNewLead,
    booking_slug: bookingSlug,
  };
}
