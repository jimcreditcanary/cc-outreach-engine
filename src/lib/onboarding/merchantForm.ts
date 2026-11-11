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
 *  ONBOARDING_FORM_BASE_URL to the branded host (https://dd.creditcanary.co.uk)
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
  socials?: { facebook?: string; linkedin?: string; twitter?: string; instagram?: string };
}
/** A data protection officer — the brief allows several per merchant. */
export interface DpoRecord {
  kind?: "person" | "company"; company?: string;
  first?: string; last?: string; title?: string; email?: string; phone?: string;
}
export interface MerchantCompliance {
  ico_number?: string; fca_frn?: string; vat_number?: string;
  /** Human-readable summary (kept for the typed form + docs). */
  dpo?: string;
  /** Structured DPOs (source for the summary). */
  dpos?: DpoRecord[];
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
  email?: string;            // migration 068
  mobile?: string;           // migration 068
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
      db.from("onboarding_ubo_kyc").select("*").eq("case_id", caseId),
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

// ── Slice savers ────────────────────────────────────────────────────────────
// Each persists one part of the submission. The single-page form calls them all
// via saveMerchantForm; the multi-page wizard (Step 6 build) calls them per page
// so Save-and-Continue can persist incrementally. Status stays "draft" until
// finalizeMerchantSubmission.

/** Business / compliance / signatory block. Leaves the form row status "draft". */
export async function saveBusinessComplianceSignatory(
  db: DB, caseId: string,
  data: { business: MerchantBusiness; compliance: MerchantCompliance; signatory: MerchantSignatory },
): Promise<void> {
  const up = await db.from("onboarding_merchant_form").upsert(
    { case_id: caseId, business: data.business, compliance: data.compliance, signatory: data.signatory, status: "draft" },
    { onConflict: "case_id" },
  );
  if (up.error) throw up.error;
}

/** Replace the per-UBO KYC rows (clean resubmit — avoids null-ubo_id ambiguity).
 *  Resilient to migration 068 not being applied yet: if the email/mobile columns
 *  are missing, it retries without them. */
export async function saveUboKyc(db: DB, caseId: string, uboKyc: UboKycInput[]): Promise<void> {
  await db.from("onboarding_ubo_kyc").delete().eq("case_id", caseId);
  if (!uboKyc.length) return;
  const base = uboKyc.map((u) => ({
    case_id: caseId,
    ubo_id: u.ubo_id,
    ubo_name: u.ubo_name,
    date_of_birth: u.date_of_birth || null,
    exact_ownership_percent: u.exact_ownership_percent ?? null,
    residential_address: u.residential_address ?? null,
    is_pep: u.is_pep,
    pep_detail: u.pep_detail ?? null,
    consent_given: u.consent_given,
  }));
  const full = base.map((r, i) => ({ ...r, email: uboKyc[i]!.email || null, mobile: uboKyc[i]!.mobile || null }));
  let ins = await db.from("onboarding_ubo_kyc").insert(full);
  if (ins.error && /(column|schema cache|does not exist)/i.test(ins.error.message) && /(email|mobile)/i.test(ins.error.message)) {
    ins = await db.from("onboarding_ubo_kyc").insert(base);
  }
  if (ins.error) throw ins.error;
}

/** Replace the bank accounts — sort code + number encrypted at rest, CoP per
 *  account (best-effort → "unavailable"). Throws if encryption isn't configured
 *  and real accounts are supplied. */
/** Encrypt + CoP-check + insert one bank account. */
async function insertBankAccount(db: DB, caseId: string, a: BankAccountInput): Promise<void> {
  const sort = (a.sort_code ?? "").trim();
  const num = (a.account_number ?? "").trim();
  let cop_result: string | null = null;
  let cop_matched_name: string | null = null;
  try {
    const r = await getCop().check({ sortCode: sort, accountNumber: num, name: a.account_name ?? "", accountType: "business" });
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

/** Replace ALL bank accounts for a case (the one-shot single-page form path). */
export async function saveBankAccounts(db: DB, caseId: string, bankAccounts: BankAccountInput[]): Promise<number> {
  const accounts = bankAccounts.filter((a) => (a.account_number ?? "").trim());
  await db.from("onboarding_bank_accounts").delete().eq("case_id", caseId);
  if (!accounts.length) return 0;
  if (!encryptionConfigured()) throw new Error("Payment capture isn't configured yet — please contact us to complete this.");
  for (const a of accounts) await insertBankAccount(db, caseId, a);
  return accounts.length;
}

/** APPEND bank accounts (the wizard's "add a disbursal account" path — never
 *  deletes, so revisiting the page can't wipe accounts whose numbers can't be
 *  prefilled). */
export async function addBankAccounts(db: DB, caseId: string, bankAccounts: BankAccountInput[]): Promise<number> {
  const accounts = bankAccounts.filter((a) => (a.account_number ?? "").trim());
  if (!accounts.length) return 0;
  if (!encryptionConfigured()) throw new Error("Payment capture isn't configured yet — please contact us to complete this.");
  // Dedupe against what's already on file (and within this batch) by purpose +
  // account tail, so revisiting the accounts page can't add the same account
  // again (the "3 identical accounts" bug).
  const tailOf = (n: string) => n.replace(/\D/g, "").slice(-4);
  const { data: existing } = await db.from("onboarding_bank_accounts").select("purpose, account_tail").eq("case_id", caseId);
  const seen = new Set(((existing as { purpose: string; account_tail: string | null }[] | null) ?? []).map((e) => `${e.purpose}|${e.account_tail ?? ""}`));
  let added = 0;
  for (const a of accounts) {
    const key = `${a.purpose}|${tailOf(a.account_number ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await insertBankAccount(db, caseId, a);
    added++;
  }
  return added;
}

/** Remove one bank account (scoped to the case). */
export async function removeBankAccount(db: DB, caseId: string, accountId: string): Promise<void> {
  await db.from("onboarding_bank_accounts").delete().eq("case_id", caseId).eq("id", accountId);
}

/** How many bank accounts the case has on file. */
export async function countBankAccounts(db: DB, caseId: string): Promise<number> {
  const { count } = await db.from("onboarding_bank_accounts").select("id", { count: "exact", head: true }).eq("case_id", caseId);
  return count ?? 0;
}

/** Upsert the Direct Debit sub-form (non-sensitive questionnaire fields). */
export async function saveDirectDebit(db: DB, caseId: string, directDebit: DirectDebitDetails | undefined): Promise<void> {
  if (!directDebit || !Object.values(directDebit).some((v) => (v ?? "").trim())) return;
  const ddUp = await db.from("onboarding_direct_debit").upsert({ case_id: caseId, details: directDebit }, { onConflict: "case_id" });
  if (ddUp.error) throw ddUp.error;
}

/** Finalise: mark the form submitted, advance the case to merchant_submitted,
 *  log the event. */
export async function finalizeMerchantSubmission(db: DB, caseId: string, meta: { ubos: number; bankAccounts: number }): Promise<void> {
  const now = new Date().toISOString();
  await db.from("onboarding_merchant_form").update({ status: "submitted", submitted_at: now }).eq("case_id", caseId);
  await db.from("onboarding_cases").update({ status: "merchant_submitted" }).eq("id", caseId);
  await logCaseEvent(db, caseId, "merchant_submitted", { email: "merchant" }, meta);
}

/** Save the full merchant submission in one shot (the single-page form path).
 *  Delegates to the slice savers the multi-page wizard also uses. */
export async function saveMerchantForm(db: DB, caseId: string, data: MerchantFormData): Promise<void> {
  await saveBusinessComplianceSignatory(db, caseId, { business: data.business, compliance: data.compliance, signatory: data.signatory });
  await saveUboKyc(db, caseId, data.uboKyc);
  const bankCount = await saveBankAccounts(db, caseId, data.bankAccounts ?? []);
  await saveDirectDebit(db, caseId, data.directDebit);
  await finalizeMerchantSubmission(db, caseId, { ubos: data.uboKyc.length, bankAccounts: bankCount });
}

/** Mark the case merchant_in_progress the first time the merchant opens the
 *  form (so the internal view reflects they've started). Best-effort. */
export async function markFormOpened(db: DB, caseId: string, currentStatus: string): Promise<void> {
  if (currentStatus !== "merchant_invited") return;
  try {
    await db.from("onboarding_cases").update({ status: "merchant_in_progress" }).eq("id", caseId).eq("status", "merchant_invited");
  } catch { /* best-effort */ }
}
