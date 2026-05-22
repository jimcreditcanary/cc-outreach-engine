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
}

export interface ContactInput {
  pipedrive_person_id?: number;
  organisation_name?: string;
  full_name?: string;
  email?: string;
  job_title?: string;
  linkedin_url?: string;
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

const SECTOR_TOKENS: Record<string, Sector> = {
  bank: "bank",
  broker: "broker",
  building_society: "building_society",
  credit_union: "credit_union",
  direct_lender: "direct_lender",
  marketplace: "marketplace",
  sme_lender: "sme_lender",
  utility: "utility",
};

function asSector(v: unknown): Sector | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  const token = normalizeHeader(s);
  return SECTOR_TOKENS[token];
}

// ── mappers ─────────────────────────────────────────────────────────

export function mapOrg(row: RawRow): OrgInput | null {
  const ix = indexRow(row);
  const name = asString(pick(ix, ["name", "organization", "organisation", "company", "company_name"]));
  if (!name) return null; // a row with no org name is unusable
  return {
    pipedrive_org_id: asBigIntId(pick(ix, ["id", "org_id", "organization_id", "organisation_id"])),
    name,
    sector: asSector(pick(ix, ["sector", "industry", "category"])),
    location: asString(pick(ix, ["location", "address", "city", "region"])),
    website: asString(pick(ix, ["website", "url", "web", "domain"])),
    top_line_notes: asString(pick(ix, ["top_line_notes", "notes", "note", "description"])),
    is_partner: asBool(pick(ix, ["is_partner", "partner"])),
  };
}

export function mapContact(row: RawRow): ContactInput | null {
  const ix = indexRow(row);
  const full_name = asString(pick(ix, ["name", "full_name", "contact_name", "person"]));
  const email = asString(pick(ix, ["email", "email_address", "primary_email"]));
  if (!full_name && !email) return null; // need at least a name or email
  return {
    pipedrive_person_id: asBigIntId(pick(ix, ["id", "person_id", "contact_id"])),
    organisation_name: asString(pick(ix, ["organization", "organisation", "company", "company_name"])),
    full_name,
    email,
    job_title: asString(pick(ix, ["job_title", "title", "role", "position"])),
    linkedin_url: asString(pick(ix, ["linkedin_url", "linkedin", "linked_in"])),
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
