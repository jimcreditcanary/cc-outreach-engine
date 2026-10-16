// Pure HubSpot ⇄ domain mapping. No I/O — unit-tested in mapping.test.ts.
// The field-mapping rationale lives in docs/HUBSPOT_MIGRATION.md; keep the two
// in sync when properties change.
//
// Reuses that fell out of portal introspection:
//   app status='new'   → hs_lead_status = NEW   (native enum)
//   app email_guessed  → email_status  = Extrapolated (existing custom enum)
//   app confirmed email→ email_status  = Verified

import type { ContactRecord, CompanyRecord, ContactWrite } from "../crm/types";
import { recordUrl } from "./client";

// Properties we READ. Only confirmed-existing props — custom props that aren't
// created yet (lead_source, company tier/is_partner/icp/sector) are added to
// these lists once the P0 custom-property step runs, else HubSpot 400s the read.
export const CONTACT_READ_PROPS = [
  "email", "firstname", "lastname", "jobtitle", "mobilephone", "phone",
  "hs_lead_status", "email_status", "lifecyclestage",
  "hs_email_hard_bounce_reason_enum",
  "createdate", "lastmodifieddate",
] as const;

export const COMPANY_READ_PROPS = [
  "name", "domain", "website", "industry",
  "createdate", "hs_lastmodifieddate",
] as const;

// Custom props to fold in once created (see docs/HUBSPOT_MIGRATION.md).
// export const CONTACT_CUSTOM_PROPS = ["lead_source"] as const;

type Props = Record<string, string | null | undefined>;
interface HsObject { id: string | number; properties: Props; }

const str = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/** "Jane Smith" → {first:"Jane", last:"Smith"}; "Cher" → {first:"Cher"};
 *  "" → {}. Writes split a single full_name field into HubSpot's two. */
export function splitName(full: string): { firstname?: string; lastname?: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstname: parts[0] };
  return { firstname: parts[0], lastname: parts.slice(1).join(" ") };
}

export function fullName(first: string | null | undefined, last: string | null | undefined, fallback: string | null): string {
  const name = [str(first), str(last)].filter(Boolean).join(" ");
  return name || fallback || "";
}

/** HubSpot enum values come back ALL_CAPS_UNDERSCORE (e.g. COMPUTER_SOFTWARE).
 *  Title-case only those; leave already-readable text untouched. */
export function humaniseEnum(v: string | null): string | null {
  if (!v || !/^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(v)) return v;
  return v.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── read: HubSpot → domain ──────────────────────────────────────────────
export function fromHubspotContact(obj: HsObject, company?: { id: string; name: string | null } | null): ContactRecord {
  const p = obj.properties;
  const id = String(obj.id);
  const email = str(p.email);
  return {
    id,
    full_name: fullName(p.firstname, p.lastname, email),
    email,
    job_title: str(p.jobtitle),
    mobile: str(p.mobilephone) ?? str(p.phone),
    company_id: company?.id ?? null,
    company_name: company?.name ?? null,
    is_new: (p.hs_lead_status ?? "") === "NEW",
    lead_status: str(p.hs_lead_status),
    email_guessed: (p.email_status ?? "") === "Extrapolated",
    email_bounced: !!str(p.hs_email_hard_bounce_reason_enum),
    lead_source: str(p.lead_source),
    created_at: str(p.createdate),
    updated_at: str(p.lastmodifieddate),
    url: recordUrl("contacts", id),
  };
}

export function fromHubspotCompany(obj: HsObject): CompanyRecord {
  const p = obj.properties;
  const id = String(obj.id);
  return {
    id,
    name: str(p.name),
    domain: str(p.domain),
    website: str(p.website) ?? str(p.domain),
    industry: humaniseEnum(str(p.industry)),
    created_at: str(p.createdate),
    updated_at: str(p.hs_lastmodifieddate),
    url: recordUrl("companies", id),
  };
}

// ── write: domain → HubSpot properties ──────────────────────────────────
/** Build the HubSpot property patch for a contact write. Only includes keys
 *  the caller actually set (so update doesn't clobber untouched fields). */
export function toHubspotContactProps(input: ContactWrite): Props {
  const props: Props = {};
  if (input.full_name !== undefined) {
    const { firstname, lastname } = splitName(input.full_name);
    props.firstname = firstname ?? "";
    props.lastname = lastname ?? "";
  }
  if (input.email !== undefined) props.email = input.email;
  if (input.job_title !== undefined) props.jobtitle = input.job_title ?? "";
  if (input.mobile !== undefined) props.mobilephone = input.mobile ?? "";
  if (input.is_new !== undefined) props.hs_lead_status = input.is_new ? "NEW" : "IN_PROGRESS";
  if (input.email_guessed !== undefined) props.email_status = input.email_guessed ? "Extrapolated" : "Verified";
  if (input.lead_source !== undefined) props.lead_source = input.lead_source ?? "";
  return props;
}
