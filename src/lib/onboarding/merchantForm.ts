// Phase 3a — the merchant-completed onboarding form. The public token form at
// /m/<token> reads the case + its CH enrichment (to display the pre-filled
// entity/people) and collects the merchant-completed fields + per-UBO KYC.
// Writes go to migration 051 tables via serviceClient (server-side only).

import type { serviceClient } from "../db/client";
import { logCaseEvent } from "./cases";

type DB = ReturnType<typeof serviceClient>;

/** The public merchant-form URL for a token. Defaults to the app host; set
 *  ONBOARDING_FORM_BASE_URL to the branded host (https://onboarding.creditcanary.co.uk)
 *  once its DNS + host-routing are live. */
export function merchantFormUrl(token: string): string {
  const base = process.env.ONBOARDING_FORM_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  return `${base.replace(/\/$/, "")}/m/${encodeURIComponent(token)}`;
}

export interface TokenCase {
  id: string;
  status: string;
  company_number: string | null;
  hubspot_deal_id: string | null;
  product_groups: string[];
}

export interface MerchantBusiness {
  trading_name?: string; trading_address?: string; principal_office?: string;
  phone?: string; email?: string; website?: string;
}
export interface MerchantCompliance {
  ico_number?: string; fca_frn?: string; dpo?: string;
  privacy_policy_url?: string; trade_body?: string;
}
export interface MerchantSignatory { name?: string; title?: string; email?: string }

export interface UboKycInput {
  ubo_id: string | null;
  ubo_name: string;
  exact_ownership_percent?: string;
  residential_address?: Record<string, string>;
  is_pep: boolean;
  pep_detail?: string;
  consent_given: boolean;
}

export interface MerchantFormData {
  business: MerchantBusiness;
  compliance: MerchantCompliance;
  signatory: MerchantSignatory;
  uboKyc: UboKycInput[];
}

export interface StoredMerchantForm {
  business: MerchantBusiness;
  compliance: MerchantCompliance;
  signatory: MerchantSignatory;
  status: string;
  submitted_at: string | null;
}
export interface StoredUboKyc extends UboKycInput { id: string }

/** Resolve the case behind a merchant-form token (the public form's credential). */
export async function getCaseByToken(db: DB, token: string): Promise<TokenCase | null> {
  const t = token.trim();
  if (!t) return null;
  const { data } = await db
    .from("onboarding_cases")
    .select("id, status, company_number, hubspot_deal_id, product_groups")
    .eq("merchant_form_token", t)
    .maybeSingle();
  return (data as TokenCase | null) ?? null;
}

/** Load a case's saved merchant form + per-UBO KYC. Degrades to empty (not
 *  throws) before migration 051 is run. */
export async function loadMerchantForm(db: DB, caseId: string): Promise<{ form: StoredMerchantForm | null; kyc: StoredUboKyc[] }> {
  try {
    const [f, k] = await Promise.all([
      db.from("onboarding_merchant_form").select("business, compliance, signatory, status, submitted_at").eq("case_id", caseId).maybeSingle(),
      db.from("onboarding_ubo_kyc").select("id, ubo_id, ubo_name, exact_ownership_percent, residential_address, is_pep, pep_detail, consent_given").eq("case_id", caseId),
    ]);
    return {
      form: (f.data as StoredMerchantForm | null) ?? null,
      kyc: (k.data as StoredUboKyc[] | null) ?? [],
    };
  } catch {
    return { form: null, kyc: [] };
  }
}

/** Save the merchant submission: upsert the form (submitted), replace the KYC
 *  rows, advance the case to merchant_submitted, log the event. */
export async function saveMerchantForm(db: DB, caseId: string, data: MerchantFormData): Promise<void> {
  const now = new Date().toISOString();
  const up = await db.from("onboarding_merchant_form").upsert(
    { case_id: caseId, business: data.business, compliance: data.compliance, signatory: data.signatory, status: "submitted", submitted_at: now },
    { onConflict: "case_id" },
  );
  if (up.error) throw up.error;

  // Replace KYC rows (clean resubmit — avoids null-ubo_id upsert ambiguity).
  await db.from("onboarding_ubo_kyc").delete().eq("case_id", caseId);
  if (data.uboKyc.length) {
    const ins = await db.from("onboarding_ubo_kyc").insert(
      data.uboKyc.map((u) => ({
        case_id: caseId,
        ubo_id: u.ubo_id,
        ubo_name: u.ubo_name,
        exact_ownership_percent: u.exact_ownership_percent ?? null,
        residential_address: u.residential_address ?? null,
        is_pep: u.is_pep,
        pep_detail: u.pep_detail ?? null,
        consent_given: u.consent_given,
      })),
    );
    if (ins.error) throw ins.error;
  }

  await db.from("onboarding_cases").update({ status: "merchant_submitted" }).eq("id", caseId);
  await logCaseEvent(db, caseId, "merchant_submitted", { email: "merchant" }, { ubos: data.uboKyc.length });
}

/** Mark the case merchant_in_progress the first time the merchant opens the
 *  form (so the internal view reflects they've started). Best-effort. */
export async function markFormOpened(db: DB, caseId: string, currentStatus: string): Promise<void> {
  if (currentStatus !== "merchant_invited") return;
  try {
    await db.from("onboarding_cases").update({ status: "merchant_in_progress" }).eq("id", caseId).eq("status", "merchant_invited");
  } catch { /* best-effort */ }
}
