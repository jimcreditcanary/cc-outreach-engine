// Phase 3a — the merchant-completed onboarding form. The public token form at
// /m/<token> reads the case + its CH enrichment (to display the pre-filled
// entity/people) and collects the merchant-completed fields + per-UBO KYC.
// Writes go to migration 051 tables via serviceClient (server-side only).

import type { serviceClient } from "../db/client";
import { logCaseEvent } from "./cases";
import { encryptField, maskTail, encryptionConfigured } from "./crypto";
import { getCop } from "../integrations/cop";

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
  date_of_birth?: string;    // YYYY-MM-DD — for Phase 4 ID&V
  exact_ownership_percent?: string;
  residential_address?: Record<string, string>;
  is_pep: boolean;
  pep_detail?: string;
  consent_given: boolean;
}

export type BankPurpose = "settlement" | "disbursal" | "direct_debit";
export interface BankAccountInput {
  purpose: BankPurpose;
  account_name?: string;
  bank_name?: string;
  sort_code?: string;        // plaintext in → encrypted at rest
  account_number?: string;   // plaintext in → encrypted at rest
}
export interface DirectDebitDetails {
  collects_dd?: string;
  existing_sun?: string;
  payment_description?: string;
  expected_monthly_volume?: string;
  average_value?: string;
}

export interface MerchantFormData {
  business: MerchantBusiness;
  compliance: MerchantCompliance;
  signatory: MerchantSignatory;
  uboKyc: UboKycInput[];
  bankAccounts?: BankAccountInput[];
  directDebit?: DirectDebitDetails;
}

/** Safe (no plaintext numbers) bank-account view for internal display. */
export interface BankAccountSafe {
  id: string;
  purpose: BankPurpose;
  account_name: string | null;
  bank_name: string | null;
  account_tail: string | null;
  cop_result: string | null;
  cop_matched_name: string | null;
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

/** Load a case's saved merchant form + per-UBO KYC + (safe) bank accounts +
 *  DD details. Degrades to empty (not throws) before the migrations are run.
 *  Never returns plaintext account numbers — only the masked tail. */
export async function loadMerchantForm(db: DB, caseId: string): Promise<{
  form: StoredMerchantForm | null;
  kyc: StoredUboKyc[];
  bankAccounts: BankAccountSafe[];
  directDebit: DirectDebitDetails | null;
}> {
  try {
    const [f, k, banks, dd] = await Promise.all([
      db.from("onboarding_merchant_form").select("business, compliance, signatory, status, submitted_at").eq("case_id", caseId).maybeSingle(),
      db.from("onboarding_ubo_kyc").select("id, ubo_id, ubo_name, date_of_birth, exact_ownership_percent, residential_address, is_pep, pep_detail, consent_given").eq("case_id", caseId),
      db.from("onboarding_bank_accounts").select("id, purpose, account_name, bank_name, account_tail, cop_result, cop_matched_name").eq("case_id", caseId),
      db.from("onboarding_direct_debit").select("details").eq("case_id", caseId).maybeSingle(),
    ]);
    return {
      form: (f.data as StoredMerchantForm | null) ?? null,
      kyc: (k.data as StoredUboKyc[] | null) ?? [],
      bankAccounts: (banks.data as BankAccountSafe[] | null) ?? [],
      directDebit: ((dd.data as { details: DirectDebitDetails } | null)?.details) ?? null,
    };
  } catch {
    return { form: null, kyc: [], bankAccounts: [], directDebit: null };
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
        date_of_birth: u.date_of_birth || null,
        exact_ownership_percent: u.exact_ownership_percent ?? null,
        residential_address: u.residential_address ?? null,
        is_pep: u.is_pep,
        pep_detail: u.pep_detail ?? null,
        consent_given: u.consent_given,
      })),
    );
    if (ins.error) throw ins.error;
  }

  // Bank accounts — sort code + number encrypted at rest; CoP per account
  // (best-effort → "unavailable" if the PSP isn't wired yet). Replace on resubmit.
  const accounts = (data.bankAccounts ?? []).filter((a) => (a.account_number ?? "").trim());
  await db.from("onboarding_bank_accounts").delete().eq("case_id", caseId);
  if (accounts.length) {
    if (!encryptionConfigured()) throw new Error("Payment capture isn't configured yet — please contact us to complete this.");
    const cop = getCop();
    for (const a of accounts) {
      const sort = (a.sort_code ?? "").trim();
      const num = (a.account_number ?? "").trim();
      let cop_result: string | null = null;
      let cop_matched_name: string | null = null;
      try {
        const r = await cop.check({ sortCode: sort, accountNumber: num, name: a.account_name ?? "", accountType: "business" });
        cop_result = r.result;
        cop_matched_name = r.matchedName;
      } catch {
        cop_result = "unavailable";
      }
      const ins = await db.from("onboarding_bank_accounts").insert({
        case_id: caseId,
        purpose: a.purpose,
        account_name: a.account_name ?? null,
        bank_name: a.bank_name ?? null,
        sort_code_enc: encryptField(sort),
        account_number_enc: encryptField(num),
        account_tail: num.replace(/\D/g, "").slice(-4) || null,
        cop_result,
        cop_matched_name,
        cop_checked_at: new Date().toISOString(),
      });
      if (ins.error) throw ins.error;
    }
  }

  // Direct Debit sub-form (non-sensitive questionnaire fields).
  if (data.directDebit && Object.values(data.directDebit).some((v) => (v ?? "").trim())) {
    const ddUp = await db.from("onboarding_direct_debit").upsert({ case_id: caseId, details: data.directDebit }, { onConflict: "case_id" });
    if (ddUp.error) throw ddUp.error;
  }

  await db.from("onboarding_cases").update({ status: "merchant_submitted" }).eq("id", caseId);
  await logCaseEvent(db, caseId, "merchant_submitted", { email: "merchant" }, { ubos: data.uboKyc.length, bankAccounts: accounts.length });
}

/** Mark the case merchant_in_progress the first time the merchant opens the
 *  form (so the internal view reflects they've started). Best-effort. */
export async function markFormOpened(db: DB, caseId: string, currentStatus: string): Promise<void> {
  if (currentStatus !== "merchant_invited") return;
  try {
    await db.from("onboarding_cases").update({ status: "merchant_in_progress" }).eq("id", caseId).eq("status", "merchant_invited");
  } catch { /* best-effort */ }
}
