"use server";

// Public submit for the merchant onboarding form. No auth — the unguessable
// merchant_form_token is the credential. Validates the token → case, saves the
// submission (merchant_submitted), and alerts the team.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import {
  getCaseByToken, saveMerchantForm, saveBusinessComplianceSignatory, saveUboKyc,
  saveBankAccounts, saveDirectDebit, finalizeMerchantSubmission,
  type MerchantFormData, type UboKycInput, type BankAccountInput, type DirectDebitDetails,
} from "@/lib/onboarding/merchantForm";
import { saveUpload } from "@/lib/onboarding/uploads";
import { notifyMerchantSubmitted } from "@/lib/onboarding/notify";
import { generateDocsForCase } from "@/lib/onboarding/docgen";
import { getFormEditor, setFormEditor } from "@/lib/onboarding/formEditor";
import { getAnswers, setAnswers, setPageComplete, type FormEditor, type AnswerInput } from "@/lib/onboarding/formAnswers";
import { listStakeholders, ONBOARDING_ROLES } from "@/lib/onboarding/cases";
import { hubspotRepo } from "@/lib/hubspot/repo";
import { requiresFcaFrn } from "@/lib/onboarding/productGroups";
import { COMPANY_FIELDS, projectCompanyAnswers, missingCompanyFields, nextFormPage } from "./fields";

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
    // Regenerate the document pack with the customer's submitted data so ops
    // reviews a complete set (best-effort; keeps the merchant_submitted status).
    await generateDocsForCase(db, c.id, { id: null, email: "merchant" }, { advanceStatus: false }).catch(() => {});
    // Route to ops@ for internal review (feedback item 7b).
    await notifyMerchantSubmitted(db, c.id).catch(() => {});
  } catch (e) {
    console.error(`[merchant-submit] save failed for case ${c.id}:`, e);
    redirect(`${back}?error=save`);
  }
  redirect(`${back}?done=1`);
}

// ── Multi-page wizard (ONBOARDING_FORM_V2) ───────────────────────────────────

const qp = (v2: string) => (v2 ? `&v2=${encodeURIComponent(v2)}` : "");

function parseUbos(formData: FormData): UboKycInput[] {
  const count = Number(str(formData.get("ubo_count")) || 0);
  const out: UboKycInput[] = [];
  for (let i = 0; i < count; i++) {
    const ubo_name = str(formData.get(`ubo_name_${i}`));
    if (!ubo_name) continue;
    out.push({
      ubo_id: str(formData.get(`ubo_id_${i}`)) || null,
      ubo_name,
      date_of_birth: str(formData.get(`ubo_dob_${i}`)),
      exact_ownership_percent: str(formData.get(`ubo_pct_${i}`)),
      residential_address: {
        line1: str(formData.get(`ubo_addr1_${i}`)), line2: str(formData.get(`ubo_addr2_${i}`)),
        city: str(formData.get(`ubo_city_${i}`)), postcode: str(formData.get(`ubo_postcode_${i}`)), country: str(formData.get(`ubo_country_${i}`)),
      },
      is_pep: str(formData.get(`ubo_pep_${i}`)) === "yes",
      pep_detail: str(formData.get(`ubo_pep_detail_${i}`)),
      consent_given: str(formData.get(`ubo_consent_${i}`)) === "on",
    });
  }
  return out;
}

function parseBankAccounts(formData: FormData): BankAccountInput[] {
  const out: BankAccountInput[] = [];
  const settlement: BankAccountInput = {
    purpose: "settlement",
    account_name: str(formData.get("settle_account_name")), bank_name: str(formData.get("settle_bank_name")),
    sort_code: str(formData.get("settle_sort_code")), account_number: str(formData.get("settle_account_number")),
  };
  if (settlement.account_number) out.push(settlement);
  const dd: BankAccountInput = {
    purpose: "direct_debit",
    account_name: str(formData.get("dd_account_name")), bank_name: str(formData.get("dd_bank_name")),
    sort_code: str(formData.get("dd_sort_code")), account_number: str(formData.get("dd_account_number")),
  };
  if (dd.account_number) out.push(dd);
  return out;
}

function parseDd(formData: FormData): DirectDebitDetails {
  return {
    collects_dd: str(formData.get("dd_collects")), existing_sun: str(formData.get("dd_existing_sun")),
    payment_description: str(formData.get("dd_payment_description")),
    expected_monthly_volume: str(formData.get("dd_expected_volume")), average_value: str(formData.get("dd_average_value")),
  };
}

/** Self-identify on the shared link: record WHO is filling the form in (for
 *  per-field attribution). Resolves name/email/role from the case's stakeholders
 *  server-side when a known contact is chosen. */
export async function setEditorAction(formData: FormData) {
  const token = str(formData.get("token"));
  const v2 = str(formData.get("v2"));
  const back = `/m/${encodeURIComponent(token)}`;
  const db = serviceClient();
  const c = await getCaseByToken(db, token);
  if (!c) redirect(`${back}?error=token`);

  const contactId = str(formData.get("editor_contact_id"));
  let name = str(formData.get("editor_name"));
  let email: string | null = str(formData.get("editor_email")) || null;
  let role: string | null = null;

  if (contactId && contactId !== "other") {
    const stakeholders = await listStakeholders(db, c.id);
    const roles = stakeholders.filter((s) => s.hubspot_contact_id === contactId).map((s) => s.role);
    if (roles.length) {
      const ct = await hubspotRepo.getContact(contactId).catch(() => null);
      name = ct?.full_name || name || contactId;
      email = (ct?.email ?? email) || null;
      role = roles.map((r) => ONBOARDING_ROLES.find((x) => x.key === r)?.label ?? r).join(", ");
    }
  }
  if (!name) name = "Someone";
  await setFormEditor({ case_id: c.id, contact_id: contactId === "other" ? null : contactId || null, name, email, role });
  redirect(`${back}?page=company${qp(v2)}`);
}

/** Per-page save. mode=draft → Save-and-Continue (persist, no validation).
 *  mode=continue → validate the page's required fields, mark it complete, advance. */
export async function savePageAction(formData: FormData) {
  const token = str(formData.get("token"));
  const page = str(formData.get("page"));
  const mode = str(formData.get("mode"));
  const v2 = str(formData.get("v2"));
  const back = `/m/${encodeURIComponent(token)}`;
  const db = serviceClient();
  const c = await getCaseByToken(db, token);
  if (!c) redirect(`${back}?error=token`);
  const editor = await getFormEditor(c.id);
  // Attribute to the editor's email, falling back to their name when they gave none.
  const ed: FormEditor | undefined = editor ? { email: editor.email || editor.name, role: editor.role } : undefined;
  const advance = () => `${back}?page=${nextFormPage(c.product_groups, page)}${qp(v2)}`;

  let dest = `${back}?page=${page}${qp(v2)}`;
  let failed = false;
  try {
    if (page === "company") {
      const tuCredit = c.product_groups.includes("tu_credit");
      const entries: AnswerInput[] = [];
      for (const f of COMPANY_FIELDS) {
        if (f.onlyIfTuCredit && !tuCredit) continue;
        entries.push({ field_key: f.key, value: str(formData.get(f.key)), is_unknown: str(formData.get(`${f.key}__unknown`)) === "on" });
      }
      await setAnswers(db, c.id, entries, ed);
      if (mode === "continue") {
        const answers = await getAnswers(db, c.id);
        const missing = missingCompanyFields(answers, { fcaRequired: requiresFcaFrn(c.product_groups), tuCredit });
        if (missing.length) dest = `${back}?page=company&error=required${qp(v2)}`;
        else { await setPageComplete(db, c.id, "company", true); dest = advance(); }
      }
    } else if (page === "ubos") {
      await saveUboKyc(db, c.id, parseUbos(formData));
      if (mode === "continue") { await setPageComplete(db, c.id, "ubos", true); dest = advance(); }
    } else if (page === "accounts") {
      await saveBankAccounts(db, c.id, parseBankAccounts(formData));
      if (mode === "continue") { await setPageComplete(db, c.id, "accounts", true); dest = advance(); }
    } else if (page === "payments") {
      await saveDirectDebit(db, c.id, parseDd(formData));
      if (mode === "continue") { await setPageComplete(db, c.id, "payments", true); dest = advance(); }
    } else if (page === "infosec") {
      const files = formData.getAll("infosec_files").filter((f): f is File => f instanceof File && f.size > 0);
      for (const f of files.slice(0, 10)) {
        if (f.size > 20 * 1024 * 1024) continue;
        try { await saveUpload(db, c.id, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }); } catch { /* best-effort */ }
      }
      if (mode === "continue") { await setPageComplete(db, c.id, "infosec", true); dest = advance(); }
    }
  } catch (e) {
    console.error(`[merchant-page-save] ${page} failed for case ${c.id}:`, e);
    failed = true;
  }
  if (failed) redirect(`${back}?page=${page}&error=save${qp(v2)}`);
  redirect(dest);
}

/** Submit for Approval (from the review page): project the company answers into
 *  the typed form, finalise, regenerate docs, route to ops. UBO / bank / DD were
 *  persisted by their pages. No email to the customer. */
export async function submitForApprovalAction(formData: FormData) {
  const token = str(formData.get("token"));
  const v2 = str(formData.get("v2"));
  const back = `/m/${encodeURIComponent(token)}`;
  const db = serviceClient();
  const c = await getCaseByToken(db, token);
  if (!c) redirect(`${back}?error=token`);
  if (c.status === "merchant_submitted") redirect(`${back}?done=1`);

  const answers = await getAnswers(db, c.id);
  const missing = missingCompanyFields(answers, { fcaRequired: requiresFcaFrn(c.product_groups), tuCredit: c.product_groups.includes("tu_credit") });
  if (missing.length) redirect(`${back}?page=company&error=required${qp(v2)}`);

  let failed = false;
  try {
    await saveBusinessComplianceSignatory(db, c.id, projectCompanyAnswers(answers));
    const [uboRes, bankRes] = await Promise.all([
      db.from("onboarding_ubo_kyc").select("id", { count: "exact", head: true }).eq("case_id", c.id),
      db.from("onboarding_bank_accounts").select("id", { count: "exact", head: true }).eq("case_id", c.id),
    ]);
    await finalizeMerchantSubmission(db, c.id, { ubos: uboRes.count ?? 0, bankAccounts: bankRes.count ?? 0 });
    await generateDocsForCase(db, c.id, { id: null, email: "merchant" }, { advanceStatus: false }).catch(() => {});
    await notifyMerchantSubmitted(db, c.id).catch(() => {});
  } catch (e) {
    console.error(`[merchant-submit v2] failed for case ${c.id}:`, e);
    failed = true;
  }
  if (failed) redirect(`${back}?page=review&error=save${qp(v2)}`);
  redirect(`${back}?done=1`);
}
