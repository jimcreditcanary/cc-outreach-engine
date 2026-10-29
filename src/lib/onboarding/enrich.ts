// Phase 2 — Companies House deep enrichment for an onboarding case. Pulls the
// profile, officers, PSCs, charges and insolvency; keeps officers that are
// current or resigned ≤12 months (§4 addendum); name-checks each against the
// disqualified-officers register (best-effort, flagged for human verification,
// never an automatic decision); and builds the UBO chain by recursing corporate
// PSCs (bounded depth, cycle-guarded). Re-running replaces the case's rows.
//
// Writes to migration 050 tables. All CH calls go through the adapter, so this
// runs end-to-end against the fixture mock before a live key is set.

import type { serviceClient } from "../db/client";
import { getCompaniesHouse, type CompaniesHouseClient, type ChPsc } from "../integrations/companiesHouse";
import { getCase, logCaseEvent } from "./cases";

type DB = ReturnType<typeof serviceClient>;
const MAX_PSC_DEPTH = 2;        // onboarding company (0) → corporate PSC (1) → its PSC (2)
const RECENT_RESIGN_DAYS = 366; // "resigned ≤12 months"

/** Keep current officers (no resignation) + those resigned within 12 months. */
function keepOfficer(resignedOn: string | null): boolean {
  if (!resignedOn) return true;
  const t = new Date(resignedOn).getTime();
  if (Number.isNaN(t)) return false;
  return t >= Date.now() - RECENT_RESIGN_DAYS * 86_400_000;
}

export interface EnrichResult {
  officers: number;
  resignedKept: number;
  ubos: number;
  accountsOverdue: boolean;
  csOverdue: boolean;
  charges: number;
  insolvency: boolean;
  disqualifiedFound: boolean;
}

export async function enrichCompanyForCase(
  db: DB, caseId: string, actor: { id?: string | null; email?: string | null },
): Promise<EnrichResult> {
  const c = await getCase(db, caseId);
  if (!c?.company_number) throw new Error("Confirm the company (step 1) before enriching.");
  const ch = getCompaniesHouse();
  const num = c.company_number;

  const [profile, officersAll, charges, insolvency] = await Promise.all([
    ch.getProfile(num),
    ch.getOfficers(num),
    ch.getCharges(num),
    ch.getInsolvency(num),
  ]);
  if (!profile) throw new Error(`Companies House has no company ${num}.`);

  const officers = officersAll.filter((o) => keepOfficer(o.resigned_on));

  // Disqualified-officers register: fuzzy name match per kept officer. Flagged
  // for human verification only — a name hit is NOT a determination.
  let disqualifiedFound = false;
  const disqByKey = new Map<string, unknown>();
  for (const o of officers) {
    try {
      const matches = await ch.searchDisqualified(o.name);
      if (matches.length > 0) { disqualifiedFound = true; disqByKey.set(o.appointment_id ?? o.name, matches); }
    } catch { /* best-effort */ }
  }

  // Replace any prior enrichment for this case (point-in-time snapshot).
  await db.from("onboarding_ubos").delete().eq("case_id", caseId);
  await db.from("onboarding_officers").delete().eq("case_id", caseId);
  await db.from("onboarding_company_snapshot").delete().eq("case_id", caseId);

  await db.from("onboarding_company_snapshot").insert({
    case_id: caseId,
    company_number: profile.company_number,
    company_name: profile.company_name,
    company_status: profile.company_status,
    company_type: profile.type,
    incorporation_date: profile.date_of_creation,
    sic_codes: profile.sic_codes,
    registered_office: profile.registered_office_address,
    previous_names: profile.previous_company_names,
    accounts_next_due: profile.accounts?.next_due ?? null,
    accounts_last_made_up: profile.accounts?.last_made_up_to ?? null,
    accounts_overdue: profile.accounts?.overdue ?? false,
    confirmation_statement_next_due: profile.confirmation_statement?.next_due ?? null,
    confirmation_statement_overdue: profile.confirmation_statement?.overdue ?? false,
    has_charges: charges.total > 0 || profile.has_charges,
    has_insolvency_history: profile.has_insolvency_history || (insolvency?.cases ?? 0) > 0,
    disqualified_officer_found: disqualifiedFound,
    raw: profile.raw,
    enriched_at: new Date().toISOString(),
  });

  if (officers.length) {
    await db.from("onboarding_officers").insert(
      officers.map((o) => ({
        case_id: caseId,
        ch_appointment_id: o.appointment_id,
        name: o.name,
        officer_role: o.officer_role,
        appointed_on: o.appointed_on,
        resigned_on: o.resigned_on,
        nationality: o.nationality,
        occupation: o.occupation,
        country_of_residence: o.country_of_residence,
        dob_month: o.date_of_birth?.month ?? null,
        dob_year: o.date_of_birth?.year ?? null,
        address: o.address,
        is_disqualified: disqByKey.has(o.appointment_id ?? o.name),
        disqualification: disqByKey.get(o.appointment_id ?? o.name) ?? null,
        raw: o.raw,
      })),
    );
  }

  const ubos = await insertPscTree(db, ch, caseId, num, null, 0, new Set<string>());

  const result: EnrichResult = {
    officers: officers.length,
    resignedKept: officers.filter((o) => o.resigned_on).length,
    ubos,
    accountsOverdue: profile.accounts?.overdue ?? false,
    csOverdue: profile.confirmation_statement?.overdue ?? false,
    charges: charges.total,
    insolvency: profile.has_insolvency_history || (insolvency?.cases ?? 0) > 0,
    disqualifiedFound,
  };
  await logCaseEvent(db, caseId, "ch_enriched", actor, result);
  return result;
}

export interface CompanySnapshot {
  company_number: string;
  company_name: string | null;
  company_status: string | null;
  company_type: string | null;
  incorporation_date: string | null;
  sic_codes: string[];
  registered_office: Record<string, string | undefined> | null;
  accounts_next_due: string | null;
  accounts_overdue: boolean;
  confirmation_statement_next_due: string | null;
  confirmation_statement_overdue: boolean;
  has_charges: boolean;
  has_insolvency_history: boolean;
  disqualified_officer_found: boolean;
  enriched_at: string | null;
}
export interface OfficerRow {
  id: string; name: string; officer_role: string | null;
  appointed_on: string | null; resigned_on: string | null;
  nationality: string | null; occupation: string | null;
  dob_month: number | null; dob_year: number | null; is_disqualified: boolean;
}
export interface UboRow {
  id: string; parent_id: string | null; depth: number; via_company_number: string | null;
  kind: string | null; is_corporate: boolean; name: string | null;
  natures_of_control: string[]; dob_month: number | null; dob_year: number | null;
  identification: Record<string, unknown> | null;
}

/** Load a case's stored enrichment for display. Degrades to empty (not throws)
 *  before migration 050 is run — the tables just aren't there yet. */
export async function loadEnrichment(db: DB, caseId: string): Promise<{
  snapshot: CompanySnapshot | null; officers: OfficerRow[]; ubos: UboRow[];
}> {
  try {
    const [snap, offs, ubos] = await Promise.all([
      db.from("onboarding_company_snapshot").select("*").eq("case_id", caseId).maybeSingle(),
      db.from("onboarding_officers").select("id, name, officer_role, appointed_on, resigned_on, nationality, occupation, dob_month, dob_year, is_disqualified").eq("case_id", caseId).order("resigned_on", { ascending: true, nullsFirst: true }),
      db.from("onboarding_ubos").select("id, parent_id, depth, via_company_number, kind, is_corporate, name, natures_of_control, dob_month, dob_year, identification").eq("case_id", caseId).order("depth", { ascending: true }),
    ]);
    return {
      snapshot: (snap.data as CompanySnapshot | null) ?? null,
      officers: (offs.data as OfficerRow[] | null) ?? [],
      ubos: (ubos.data as UboRow[] | null) ?? [],
    };
  } catch {
    return { snapshot: null, officers: [], ubos: [] };
  }
}

/** Insert the PSCs of `companyNumber` as UBO nodes, recursing into corporate
 *  PSCs (UK, bounded depth, cycle-guarded). Returns the node count. */
async function insertPscTree(
  db: DB, ch: CompaniesHouseClient, caseId: string,
  companyNumber: string, parentId: string | null, depth: number, visited: Set<string>,
): Promise<number> {
  if (depth > MAX_PSC_DEPTH || visited.has(companyNumber)) return 0;
  visited.add(companyNumber);
  let pscs: ChPsc[];
  try { pscs = await ch.getPscs(companyNumber); } catch { return 0; }

  let count = 0;
  for (const p of pscs) {
    const isCorp = /corporate-entity|legal-person/.test(p.kind);
    const { data } = await db
      .from("onboarding_ubos")
      .insert({
        case_id: caseId,
        parent_id: parentId,
        depth,
        via_company_number: companyNumber,
        kind: p.kind,
        is_corporate: isCorp,
        name: p.name,
        natures_of_control: p.natures_of_control,
        notified_on: p.notified_on,
        ceased_on: p.ceased_on,
        nationality: p.nationality,
        country_of_residence: p.country_of_residence,
        dob_month: p.date_of_birth?.month ?? null,
        dob_year: p.date_of_birth?.year ?? null,
        address: p.address,
        identification: p.identification,
        raw: p.raw,
      })
      .select("id")
      .single();
    count++;

    const insertedId = (data as { id: string } | null)?.id;
    if (isCorp && insertedId && p.identification) {
      const reg = String(p.identification.registration_number ?? "").trim();
      const country = String(p.identification.country_registered ?? p.identification.place_registered ?? "").toLowerCase();
      const ukish = !country || /united kingdom|england|wales|scotland|gb|uk/.test(country);
      if (reg && ukish) count += await insertPscTree(db, ch, caseId, reg, insertedId, depth + 1, visited);
    }
  }
  return count;
}
