// Lead capture — the single path that turns an inbound signal (whitepaper
// download via POST /api/leads, or the /enquire form) into CRM state:
//
//   1. contact: matched by email (never duplicated). New ones land with
//      status='new' so they surface instantly on /contacts; existing ones
//      keep their status — an established customer who downloads a paper is
//      a buying signal, not a new lead.
//   2. company: linked from the contact's existing org, else matched by
//      name, else created (opt-in — the API trusts a named company on a
//      gated download; the public enquiry form does not, to avoid junk).
//   3. a 'lead' timeline event carrying the source + asset, so you can see
//      exactly what they did and when.
//   4. an /alerts row for triage (deduped per contact+asset+day so a
//      double-click doesn't double-alert).
//   5. an optional notification email to the lead owner.
//
// Every write is resilient to migration 036 not having run yet: status /
// lead_source / the 'lead' event type all degrade cleanly.

import type { serviceClient } from "../db/client";
import { sendTransactional } from "../send/postmark";

type DB = ReturnType<typeof serviceClient>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type LeadKind = "download" | "enquiry" | "lead";

export interface LeadInput {
  email: string;
  name?: string | null;
  company?: string | null;
  job_title?: string | null;
  /** Where it came from: 'whitepaper', 'website', 'linkedin', … */
  source?: string | null;
  /** What they engaged with: a whitepaper title/slug, campaign, etc. */
  asset?: string | null;
  /** The page URL the action happened on (stored on the event). */
  url?: string | null;
  /** Free-text message (enquiry forms). */
  message?: string | null;
  mobile?: string | null;
  kind: LeadKind;
  /** Create the company when no match is found (API: true; enquiry: false). */
  createCompany?: boolean;
  /** Email the lead owner. Default true. */
  notify?: boolean;
}

export interface LeadResult {
  ok: boolean;
  error?: string;
  contact_id?: string;
  organisation_id?: string | null;
  /** A brand-new contact row was created. */
  created_contact?: boolean;
  /** The contact is flagged status='new' (i.e. created_contact && migration run). */
  is_new_lead?: boolean;
  /** The owner's booking slug, if configured (for thank-you CTAs). */
  booking_slug?: string | null;
}

/** Who owns inbound leads: INBOUND_LEAD_EMAIL env wins, else the workspace
 *  reply-to. Mapped back to an operator id (ownership) + booking slug. */
export async function resolveInboundOwner(
  db: DB,
): Promise<{ ownerId: string | null; notifyEmail: string; bookingSlug: string | null }> {
  const notifyEmail = process.env.INBOUND_LEAD_EMAIL ?? process.env.POSTMARK_REPLY_TO ?? "jimfell@creditcanary.co.uk";
  let rows: { user_id: string; reply_to_email: string | null; booking_slug?: string | null }[] = [];
  const withSlug = await db.from("user_settings").select("user_id, reply_to_email, booking_slug").not("reply_to_email", "is", null);
  if (withSlug.error) {
    // Migration 035 (booking_slug) not applied — owner mapping still works.
    const bare = await db.from("user_settings").select("user_id, reply_to_email").not("reply_to_email", "is", null);
    rows = (bare.data ?? []) as typeof rows;
  } else {
    rows = (withSlug.data ?? []) as typeof rows;
  }
  const hit = rows.find((r) => (r.reply_to_email ?? "").toLowerCase() === notifyEmail.toLowerCase());
  return { ownerId: hit?.user_id ?? null, notifyEmail, bookingSlug: hit?.booking_slug ?? null };
}

/** Insert a contact, retrying without status/lead_source if migration 036
 *  hasn't added those columns yet. Returns the new id + whether status stuck. */
async function insertContact(
  db: DB,
  base: { full_name: string; email: string; organisation_id: string | null; owner_id: string | null; mobile: string | null; job_title: string | null },
  source: string | null,
): Promise<{ id: string; statusApplied: boolean } | null> {
  const full = { ...base, status: "new", lead_source: source };
  let res = await db.from("contacts").insert(full).select("id").single();
  if (res.error && /status|lead_source/.test(res.error.message)) {
    res = await db.from("contacts").insert(base).select("id").single();
    if (!res.error && res.data) return { id: res.data.id as string, statusApplied: false };
  } else if (!res.error && res.data) {
    return { id: res.data.id as string, statusApplied: true };
  }
  return null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function eventMessage(input: LeadInput): string {
  const via = input.source ? ` · via ${input.source}` : "";
  switch (input.kind) {
    case "download":
      return `📄 Downloaded ${input.asset ? `“${input.asset}”` : "a resource"}${via}`;
    case "enquiry":
      return `📥 Enquiry${input.source ? ` (via ${input.source})` : ""}: ${input.message?.trim() || "(no message left)"}`;
    default:
      return `📥 New lead${via}${input.asset ? ` — ${input.asset}` : ""}`;
  }
}

/** Fields rendered in the owner lead-alert email. */
export interface LeadNotifyFields {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string | null;
  jobTitle: string | null;
  company: string | null;
  /** Item downloaded or form/source, e.g. "Browser Abandonment Form". */
  itemSource: string | null;
  /** The contact's record in HubSpot (null on the Supabase path). */
  hubspotUrl: string | null;
  /** The contact's page in VeepVeep. */
  veepUrl: string;
}

const escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The owner lead-alert email: subject "New Lead Alert" + a clean field table
 *  (First/Last/Email/Mobile/Job title/Company/Item or Source + HubSpot & VeepVeep
 *  links). Shared by both capture paths so the format stays identical. */
export function leadNotificationEmail(f: LeadNotifyFields): { subject: string; textBody: string; htmlBody: string } {
  const fieldRows: [string, string][] = [
    ["First name", f.firstName || "—"],
    ["Last name", f.lastName || "—"],
    ["Email", f.email],
    ["Mobile", f.mobile || "—"],
    ["Job title", f.jobTitle || "—"],
    ["Company", f.company || "—"],
    ["Item / Source", f.itemSource || "—"],
  ];
  const linkRows: [string, string][] = [];
  if (f.hubspotUrl) linkRows.push(["Open in HubSpot", f.hubspotUrl]);
  linkRows.push(["Open in VeepVeep", f.veepUrl]);

  const cellK = 'style="padding:7px 14px;border:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#475569;white-space:nowrap"';
  const cellV = 'style="padding:7px 14px;border:1px solid #e5e7eb;color:#0f172a"';
  const rowHtml = ([k, v]: [string, string], link = false) =>
    `<tr><td ${cellK}>${escHtml(k)}</td><td ${cellV}>${link ? `<a href="${escHtml(v)}" style="color:#2563eb">${escHtml(v)}</a>` : escHtml(v)}</td></tr>`;
  const htmlBody =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#0f172a">` +
    `<h2 style="margin:0 0 12px;font-size:16px">New Lead Alert</h2>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    fieldRows.map((r) => rowHtml(r)).join("") +
    linkRows.map((r) => rowHtml(r, true)).join("") +
    `</table></div>`;
  const textBody = [...fieldRows, ...linkRows].map(([k, v]) => `${k}: ${v}`).join("\n");
  return { subject: "New Lead Alert", textBody, htmlBody };
}

/** "Jane Smith" → ["Jane","Smith"]; single token → first only. */
export function splitLeadName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return [parts[0] ?? full.trim(), parts.slice(1).join(" ")];
}

export async function captureLead(db: DB, input: LeadInput): Promise<LeadResult> {
  const email = (input.email ?? "").trim().toLowerCase();
  const name = (input.name ?? "").trim().slice(0, 120) || email.split("@")[0] || email;
  const company = (input.company ?? "").trim().slice(0, 120) || null;
  if (!EMAIL_RE.test(email)) return { ok: false, error: "A valid email is required." };

  const { ownerId, notifyEmail, bookingSlug } = await resolveInboundOwner(db);

  // ── Contact: match by email, never duplicate ──────────────────────
  // Select status/lead_source only if migration 036 ran. CRITICAL: if those
  // columns don't exist yet and we select them, the query errors and returns
  // null — which would silently treat EVERY existing contact as new and
  // create duplicates. So fall back to the always-present columns.
  type ExistingContact = { id: string; organisation_id: string | null; status?: string | null; lead_source?: string | null };
  let existing: ExistingContact | null = null;
  const rich = await db.from("contacts").select("id, organisation_id, status, lead_source").ilike("email", email).maybeSingle();
  if (rich.error && /status|lead_source/.test(rich.error.message)) {
    const base = await db.from("contacts").select("id, organisation_id").ilike("email", email).maybeSingle();
    existing = (base.data as ExistingContact | null) ?? null;
  } else {
    existing = (rich.data as ExistingContact | null) ?? null;
  }

  // ── Company: existing link → name match → create (if allowed) ─────
  let organisationId: string | null = (existing?.organisation_id as string | null) ?? null;
  if (!organisationId && company) {
    const { data: org } = await db.from("organisations").select("id").ilike("name", company).maybeSingle();
    organisationId = (org?.id as string | undefined) ?? null;
    if (!organisationId && input.createCompany) {
      const { data: created } = await db
        .from("organisations")
        .insert({ name: company, owner_id: ownerId })
        .select("id")
        .single();
      organisationId = (created?.id as string | undefined) ?? null;
    }
  }

  let contactId: string;
  let createdContact = false;
  let isNewLead = false;

  if (existing) {
    contactId = existing.id as string;
    const patch: Record<string, unknown> = {};
    if (organisationId && !existing.organisation_id) patch.organisation_id = organisationId;
    // Provenance is set once. If this row never had a lead_source (e.g. an
    // imported contact who now downloads), stamp it — but never overwrite.
    if (input.source && !("lead_source" in existing && existing.lead_source)) patch.lead_source = input.source;
    if (input.mobile && input.mobile.trim()) patch.mobile = input.mobile.trim();
    if (Object.keys(patch).length > 0) {
      const upd = await db.from("contacts").update(patch).eq("id", contactId);
      // lead_source column missing → retry with just the org link.
      if (upd.error && /lead_source/.test(upd.error.message) && patch.organisation_id) {
        await db.from("contacts").update({ organisation_id: patch.organisation_id }).eq("id", contactId);
      }
    }
  } else {
    const inserted = await insertContact(
      db,
      { full_name: name, email, organisation_id: organisationId, owner_id: ownerId, mobile: input.mobile?.trim() || null, job_title: input.job_title?.trim() || null },
      input.source ?? input.kind,
    );
    if (!inserted) return { ok: false, error: "Couldn't save the contact." };
    contactId = inserted.id;
    createdContact = true;
    isNewLead = inserted.statusApplied;
  }

  // ── Timeline event (type 'lead', falling back to crm_change) ──────
  const message = eventMessage(input);
  const payload = {
    kind: input.kind === "enquiry" ? "inbound_lead" : `lead_${input.kind}`,
    message,
    source: input.source ?? null,
    asset: input.asset ?? null,
    url: input.url ?? null,
    company,
  };
  const evtBase = { contact_id: contactId, organisation_id: organisationId, owner_id: ownerId, payload, source: input.source ?? input.kind };
  const evt = await db.from("events").insert({ type: "lead", ...evtBase });
  if (evt.error && /invalid input value for enum|lead/.test(evt.error.message)) {
    await db.from("events").insert({ type: "crm_change", ...evtBase }).then(({ error }) => error && console.error("lead event:", error.message));
  } else if (evt.error) {
    console.error("lead event:", evt.error.message);
  }

  // ── Alert for triage (deduped per contact+asset+day) ──────────────
  const today = new Date().toISOString().slice(0, 10);
  const dedupKey = input.kind === "download" && input.asset
    ? `download:${contactId}:${slugify(input.asset)}:${today}`
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
        contact_id: contactId,
        organisation_id: organisationId,
        owner_id: ownerId,
        kind: input.kind === "enquiry" ? "inbound" : "lead",
        title: alertTitle,
        summary: (input.asset ? `${input.asset}. ` : "") + (input.message?.trim() ?? ""),
        link: input.url ?? null,
        source: input.source ?? input.kind,
        dedup_key: dedupKey,
      },
      dedupKey ? { onConflict: "dedup_key", ignoreDuplicates: true } : undefined,
    )
    .then(({ error }) => error && console.error("lead alert:", error.message));

  // ── Notify the owner — "New Lead Alert" field table ───────────────
  if (input.notify !== false) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
    const [firstName, lastName] = splitLeadName(name);
    const { subject, textBody, htmlBody } = leadNotificationEmail({
      firstName,
      lastName,
      email,
      mobile: input.mobile?.trim() || null,
      jobTitle: input.job_title?.trim() || null,
      company,
      itemSource: input.asset?.trim() || input.source?.trim() || null,
      hubspotUrl: null,
      veepUrl: `${appUrl}/contacts/${contactId}`,
    });
    await sendTransactional({ to: notifyEmail, subject, textBody, htmlBody, ownerId, tag: `lead-${input.kind}` }).catch(() => {});
  }

  return { ok: true, contact_id: contactId, organisation_id: organisationId, created_contact: createdContact, is_new_lead: isNewLead, booking_slug: bookingSlug };
}
