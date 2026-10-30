"use server";

// Public submit for the merchant onboarding form. No auth — the unguessable
// merchant_form_token is the credential. Validates the token → case, saves the
// submission (merchant_submitted), and alerts the team.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getCaseByToken, saveMerchantForm, type MerchantFormData, type UboKycInput, type BankAccountInput } from "@/lib/onboarding/merchantForm";
import { saveUpload } from "@/lib/onboarding/uploads";
import { notifyMerchantSubmitted } from "@/lib/onboarding/notify";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

export async function submitMerchantFormAction(formData: FormData) {
  const token = str(formData.get("token"));
  const back = `/m/${encodeURIComponent(token)}`;
  const db = serviceClient();
  const c = await getCaseByToken(db, token);
  if (!c) redirect(`${back}?error=token`);
  if (c.status === "merchant_submitted") redirect(`${back}?done=1`);

  const business = {
    trading_name: str(formData.get("trading_name")),
    trading_address: str(formData.get("trading_address")),
    principal_office: str(formData.get("principal_office")),
    phone: str(formData.get("phone")),
    email: str(formData.get("email")),
    website: str(formData.get("website")),
  };
  const compliance = {
    ico_number: str(formData.get("ico_number")),
    fca_frn: str(formData.get("fca_frn")),
    dpo: str(formData.get("dpo")),
    privacy_policy_url: str(formData.get("privacy_policy_url")),
    trade_body: str(formData.get("trade_body")),
  };
  const signatory = {
    name: str(formData.get("signatory_name")),
    title: str(formData.get("signatory_title")),
    email: str(formData.get("signatory_email")),
  };

  const count = Number(str(formData.get("ubo_count")) || 0);
  const uboKyc: UboKycInput[] = [];
  for (let i = 0; i < count; i++) {
    const ubo_name = str(formData.get(`ubo_name_${i}`));
    if (!ubo_name) continue;
    uboKyc.push({
      ubo_id: str(formData.get(`ubo_id_${i}`)) || null,
      ubo_name,
      date_of_birth: str(formData.get(`ubo_dob_${i}`)),
      exact_ownership_percent: str(formData.get(`ubo_pct_${i}`)),
      residential_address: {
        line1: str(formData.get(`ubo_addr1_${i}`)),
        line2: str(formData.get(`ubo_addr2_${i}`)),
        city: str(formData.get(`ubo_city_${i}`)),
        postcode: str(formData.get(`ubo_postcode_${i}`)),
        country: str(formData.get(`ubo_country_${i}`)),
      },
      is_pep: str(formData.get(`ubo_pep_${i}`)) === "yes",
      pep_detail: str(formData.get(`ubo_pep_detail_${i}`)),
      consent_given: str(formData.get(`ubo_consent_${i}`)) === "on",
    });
  }

  // Bank accounts (only included when the merchant filled an account number).
  const bankAccounts: BankAccountInput[] = [];
  const settlement: BankAccountInput = {
    purpose: "settlement",
    account_name: str(formData.get("settle_account_name")),
    bank_name: str(formData.get("settle_bank_name")),
    sort_code: str(formData.get("settle_sort_code")),
    account_number: str(formData.get("settle_account_number")),
  };
  if (settlement.account_number) bankAccounts.push(settlement);
  const ddAccount: BankAccountInput = {
    purpose: "direct_debit",
    account_name: str(formData.get("dd_account_name")),
    bank_name: str(formData.get("dd_bank_name")),
    sort_code: str(formData.get("dd_sort_code")),
    account_number: str(formData.get("dd_account_number")),
  };
  if (ddAccount.account_number) bankAccounts.push(ddAccount);

  const directDebit = {
    collects_dd: str(formData.get("dd_collects")),
    existing_sun: str(formData.get("dd_existing_sun")),
    payment_description: str(formData.get("dd_payment_description")),
    expected_monthly_volume: str(formData.get("dd_expected_volume")),
    average_value: str(formData.get("dd_average_value")),
  };

  const data: MerchantFormData = { business, compliance, signatory, uboKyc, bankAccounts, directDebit };
  try {
    await saveMerchantForm(db, c.id, data);
    // Infosec uploads — best-effort; never fail the submit on an upload error.
    const files = formData.getAll("infosec_files").filter((f): f is File => f instanceof File && f.size > 0);
    for (const f of files.slice(0, 10)) {
      if (f.size > 20 * 1024 * 1024) continue;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        await saveUpload(db, c.id, { name: f.name, type: f.type, bytes });
      } catch { /* best-effort */ }
    }
    await notifyMerchantSubmitted(db, c.id).catch(() => {});
  } catch {
    redirect(`${back}?error=save`);
  }
  redirect(`${back}?done=1`);
}
