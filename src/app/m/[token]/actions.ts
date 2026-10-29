"use server";

// Public submit for the merchant onboarding form. No auth — the unguessable
// merchant_form_token is the credential. Validates the token → case, saves the
// submission (merchant_submitted), and alerts the team.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getCaseByToken, saveMerchantForm, type MerchantFormData, type UboKycInput } from "@/lib/onboarding/merchantForm";
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

  const data: MerchantFormData = { business, compliance, signatory, uboKyc };
  try {
    await saveMerchantForm(db, c.id, data);
    await notifyMerchantSubmitted(db, c.id).catch(() => {});
  } catch {
    redirect(`${back}?error=save`);
  }
  redirect(`${back}?done=1`);
}
