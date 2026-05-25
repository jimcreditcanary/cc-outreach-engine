// Alias mapping: normalised CRM headers → canonical schema fields.
//
// Each canonical field lists the normalised header tokens we accept for
// it (see headers.ts). Unknown columns are ignored. This is the layer
// that absorbs column-name drift between exports, so adding a new
// accepted spelling is a one-line change here — never in the schema.

import { normalizeHeader } from "./headers";

export type Sector =
  | "bank"
  | "broker"
  | "building_society"
  | "credit_union"
  | "direct_lender"
  | "marketplace"
  | "sme_lender"
  | "utility";

export type DealStatus = "open" | "won" | "lost";

/** A parsed CSV/xlsx row, keyed by ORIGINAL header. */
export type RawRow = Record<string, unknown>;

export interface OrgInput {
  pipedrive_org_id?: number;
  name: string;
  sector?: Sector;
  location?: string;
  website?: string;
  top_line_notes?: string;
  is_partner?: boolean;
  // CC-specific targeting fields captured from the real export — these
  // are the inputs the targeting engine segments on (§6).
  icp?: boolean;
  customer_category?: string;
  customer_sub_category?: string;
  industry?: string;
  partner_category?: string;
  label?: string;
}

export interface ContactInput {
  pipedrive_person_id?: number;
  organisation_name?: string;
  full_name?: string;
  email?: string;
  job_title?: string;
  linkedin_url?: string;
  label?: string;
}

export interface NoteInput {
  pipedrive_note_id?: number;
  organisation_name?: string;
  deal_title?: string;
  contact_name?: string;
  contact_email?: string;
  content: string;
  author?: string;
  noted_at?: string;
}

export interface DealInput {
  pipedrive_deal_id?: number;
  organisation_name?: string;
  title?: string;
  status: DealStatus;
  stage?: string;
  value?: number;
  lost_reason?: string;
  proposal_exists: boolean;
}

// ── value coercion ──────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function asNumber(v: unknown): number | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function asBigIntId(v: unknown): number | undefined {
  const n = asNumber(v);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

const TRUTHY = new Set(["yes", "true", "1", "y", "partner"]);
function asBool(v: unknown): boolean | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  return TRUTHY.has(s.toLowerCase());
}

// ── header-keyed row access ─────────────────────────────────────────

/** Index a raw row by normalised header for alias lookups. */
function indexRow(row: RawRow): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) m.set(normalizeHeader(k), v);
  return m;
}

/** First non-empty value among the accepted aliases. */
function pick(indexed: Map<string, unknown>, aliases: readonly string[]): unknown {
  for (const a of aliases) {
    if (indexed.has(a)) {
      const v = indexed.get(a);
      if (asString(v) !== undefined) return v;
    }
  }
  return undefined;
}

// ── sector parsing ──────────────────────────────────────────────────

/** Lower-case + snake_case a free-text value (not a header). */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Real-world spellings (incl. plurals) seen in the CRM's Industry/Type
// columns → the canonical sector enum. Values not listed here (Auto
// Finance, Platforms, Consulting, Insurance, CDFI, ...) stay null until
// reconciled against the targeting map.
const SECTOR_SYNONYMS: Record<string, Sector> = {
  bank: "bank",
  banks: "bank",
  building_society: "building_society",
  building_societies: "building_society",
  credit_union: "credit_union",
  credit_unions: "credit_union",
  direct_lender: "direct_lender",
  direct_lenders: "direct_lender",
  broker: "broker",
  brokers: "broker",
  marketplace: "marketplace",
  marketplaces: "marketplace",
  sme_lender: "sme_lender",
  utility: "utility",
  utilities: "utility",
};

/** First recognised sector in a possibly comma-separated cell. */
function asSector(v: unknown): Sector | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  for (const part of s.split(",")) {
    const hit = SECTOR_SYNONYMS[slug(part)];
    if (hit) return hit;
  }
  return undefined;
}

// ── mappers ─────────────────────────────────────────────────────────

export function mapOrg(row: RawRow): OrgInput | null {
  const ix = indexRow(row);
  const name = asString(pick(ix, ["name", "organization", "organisation", "company", "company_name"]));
  if (!name) return null; // a row with no org name is unusable

  const partner_category = asString(pick(ix, ["partner_category"]));
  const explicitPartner = asBool(pick(ix, ["is_partner", "partner"]));

  return {
    pipedrive_org_id: asBigIntId(pick(ix, ["id", "org_id", "organization_id", "organisation_id"])),
    name,
    sector: asSector(pick(ix, ["sector", "industry", "type"])),
    location: asString(pick(ix, ["location", "full_combined_address_of_address", "address", "city", "region"])),
    website: asString(pick(ix, ["website", "url", "web", "domain"])),
    top_line_notes: asString(pick(ix, ["top_line_notes", "description", "notes", "note"])),
    // A partner is anyone with a Partner Category set (§12 — partners are
    // excluded from buyer outreach), unless an explicit flag says otherwise.
    is_partner: explicitPartner ?? (partner_category !== undefined ? true : undefined),
    icp: asBool(pick(ix, ["icp", "ideal_customer_profile"])),
    customer_category: asString(pick(ix, ["customer_category"])),
    customer_sub_category: asString(pick(ix, ["customer_sub_category"])),
    industry: asString(pick(ix, ["industry"])),
    partner_category,
    label: asString(pick(ix, ["label", "labels"])),
  };
}

export function mapContact(row: RawRow): ContactInput | null {
  const ix = indexRow(row);
  const full_name = asString(pick(ix, ["name", "full_name", "contact_name", "person"]));
  // Pipedrive splits email into Work/Home/Other; prefer Work for B2B.
  const email = asString(
    pick(ix, ["email", "email_work", "email_address", "email_other", "email_home", "primary_email"]),
  );
  if (!full_name && !email) return null; // need at least a name or email
  return {
    pipedrive_person_id: asBigIntId(pick(ix, ["id", "person_id", "contact_id"])),
    organisation_name: asString(pick(ix, ["organization", "organisation", "company", "company_name"])),
    full_name,
    email,
    job_title: asString(pick(ix, ["job_title", "title", "role", "position"])),
    linkedin_url: asString(pick(ix, ["linkedin_url", "linkedin", "linked_in"])),
    label: asString(pick(ix, ["label", "labels"])),
  };
}

export function mapDeal(row: RawRow): DealInput | null {
  const ix = indexRow(row);
  const title = asString(pick(ix, ["title", "deal_title", "name"]));
  const organisation_name = asString(pick(ix, ["organization", "organisation", "company", "company_name"]));
  if (!title && !organisation_name) return null;

  const lost_reason = asString(pick(ix, ["lost_reason", "lost_reasons"]));
  const explicitStatus = asString(pick(ix, ["status", "deal_status"]));
  const status = resolveStatus(explicitStatus, lost_reason);

  // proposal_exists is normally set later (when proposal_text is
  // attached), but honour an explicit column if the export carries one.
  const proposal_exists = asBool(pick(ix, ["proposal_exists", "has_proposal", "proposal"])) ?? false;

  return {
    pipedrive_deal_id: asBigIntId(pick(ix, ["id", "deal_id"])),
    organisation_name,
    title,
    status,
    stage: asString(pick(ix, ["stage", "pipeline_stage"])),
    value: asNumber(pick(ix, ["value", "deal_value", "amount"])),
    lost_reason,
    proposal_exists,
  };
}

export function mapNote(row: RawRow): NoteInput | null {
  const ix = indexRow(row);
  const content = asString(pick(ix, ["content", "note", "body", "text"]));
  if (!content) return null; // a note with no content is useless
  return {
    pipedrive_note_id: asBigIntId(pick(ix, ["id", "note_id"])),
    organisation_name: asString(pick(ix, ["organization", "organisation", "company", "company_name"])),
    deal_title: asString(pick(ix, ["deal", "deal_title"])),
    contact_name: asString(pick(ix, ["person", "contact_person", "contact", "contact_name"])),
    contact_email: asString(pick(ix, ["email", "person_email", "email_address"])),
    content,
    author: asString(pick(ix, ["user", "author", "owner", "created_by"])),
    noted_at: asString(pick(ix, ["add_time", "created", "created_at", "date", "noted_at", "update_time"])),
  };
}

/**
 * Pipedrive's simplest deal export has no status column, only a stage and
 * (when lost) a lost reason. Derive: explicit status wins; else a lost
 * reason implies lost; else open. 'won' can only come from an explicit
 * column — we never infer it.
 */
export function resolveStatus(
  explicit: string | undefined,
  lostReason: string | undefined,
): DealStatus {
  if (explicit) {
    const s = explicit.toLowerCase();
    if (s.includes("won")) return "won";
    if (s.includes("lost")) return "lost";
    if (s.includes("open")) return "open";
  }
  if (lostReason) return "lost";
  return "open";
}
