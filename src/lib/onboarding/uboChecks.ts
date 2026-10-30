// Phase 4 — run ID&V + PEP/sanctions screening for each beneficial owner via
// Call Validate, and store the outcomes (onboarding_ubo_checks). Re-running
// replaces. All checks are advisory — a human signs off; a PEP/sanctions hit is
// flagged for verification, never an automatic decision.

import type { serviceClient } from "../db/client";
import { getCallValidate, type IdvResult, type ScreeningResult } from "../integrations/callValidate";
import { logCaseEvent, updateCase } from "./cases";

type DB = ReturnType<typeof serviceClient>;

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s);

/** CH names are often "SURNAME, Firstname Middle" or ALL CAPS — normalise. */
function parseName(full: string): { firstName: string; lastName: string } {
  const s = (full || "").trim();
  if (s.includes(",")) {
    const [last, rest] = s.split(",");
    const first = (rest ?? "").trim().split(/\s+/)[0] ?? "";
    return { firstName: cap(first), lastName: cap((last ?? "").trim()) };
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: cap(parts[0]!), lastName: "" };
  return { firstName: cap(parts[0]!), lastName: cap(parts[parts.length - 1]!) };
}

interface KycRow {
  id: string;
  ubo_name: string | null;
  date_of_birth: string | null;
  residential_address: { line1?: string; line2?: string; city?: string; postcode?: string; country?: string } | null;
}

export interface UboCheckRow {
  id: string;
  ubo_name: string | null;
  idv_band: string | null;
  idv_score: number | null;
  idv_verified: boolean;
  pep_match: boolean;
  sanctions_match: boolean;
  screening_detail: { matches?: { type: string; name: string; detail?: string }[] } | null;
  checked_at: string | null;
}

export interface UboChecksResult {
  checked: number;
  verified: number;
  pepMatches: number;
  sanctionsMatches: number;
}

export async function runUboChecks(db: DB, caseId: string, actor: { id?: string | null; email?: string | null }): Promise<UboChecksResult> {
  const { data } = await db
    .from("onboarding_ubo_kyc")
    .select("id, ubo_name, date_of_birth, residential_address")
    .eq("case_id", caseId);
  const kyc = (data as KycRow[] | null) ?? [];

  await db.from("onboarding_ubo_checks").delete().eq("case_id", caseId);

  const res: UboChecksResult = { checked: 0, verified: 0, pepMatches: 0, sanctionsMatches: 0 };
  const cv = getCallValidate();

  for (const k of kyc) {
    const { firstName, lastName } = parseName(k.ubo_name ?? "");

    let idv: IdvResult;
    try {
      idv = await cv.verifyIdentity({ firstName, lastName, dob: k.date_of_birth, address: k.residential_address ?? undefined });
    } catch (e) {
      idv = { band: "unavailable", score: 0, verified: false, detail: { error: (e as Error).message } };
    }

    let screen: ScreeningResult;
    try {
      screen = await cv.screen({ firstName, lastName, dob: k.date_of_birth });
    } catch (e) {
      screen = { pepMatch: false, sanctionsMatch: false, matches: [{ type: "pep", name: `${firstName} ${lastName}`, detail: `screening unavailable: ${(e as Error).message}` }] };
    }

    await db.from("onboarding_ubo_checks").insert({
      case_id: caseId,
      ubo_kyc_id: k.id,
      ubo_name: k.ubo_name,
      idv_band: idv.band,
      idv_score: idv.score,
      idv_verified: idv.verified,
      idv_detail: idv.detail,
      pep_match: screen.pepMatch,
      sanctions_match: screen.sanctionsMatch,
      screening_detail: { matches: screen.matches },
      checked_at: new Date().toISOString(),
    });

    res.checked++;
    if (idv.verified) res.verified++;
    if (screen.pepMatch) res.pepMatches++;
    if (screen.sanctionsMatch) res.sanctionsMatches++;
  }

  await updateCase(db, caseId, { status: "ubo_checks" });
  await logCaseEvent(db, caseId, "ubo_checks_run", actor, res);
  return res;
}

export async function loadUboChecks(db: DB, caseId: string): Promise<UboCheckRow[]> {
  try {
    const { data } = await db
      .from("onboarding_ubo_checks")
      .select("id, ubo_name, idv_band, idv_score, idv_verified, pep_match, sanctions_match, screening_detail, checked_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    return (data as UboCheckRow[] | null) ?? [];
  } catch {
    return [];
  }
}
