"use server";

// Public submit for the merchant onboarding form. No auth - the unguessable
// merchant_form_token is the credential. Validates the token → case, saves the
// submission (merchant_submitted), and alerts the team.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import {
  getCaseByToken, saveMerchantForm, saveBusinessComplianceSignatory, saveUboKyc,
  addBankAccounts, removeBankAccount, countBankAccounts, saveDirectDebit, finalizeMerchantSubmission,
  type MerchantFormData, type UboKycInput, type BankAccountInput,
} from "@/lib/onboarding/merchantForm";
import { saveUpload, extractPendingUploads } from "@/lib/onboarding/uploads";
import { notifyMerchantSubmitted } from "@/lib/onboarding/notify";
import { generateDocsForCase } from "@/lib/onboarding/docgen";
import { getFormEditor, setFormEditor } from "@/lib/onboarding/formEditor";
import { getAnswers, setAnswers, setPageComplete, type FormEditor, type AnswerInput } from "@/lib/onboarding/formAnswers";
import { listStakeholders, ONBOARDING_ROLES } from "@/lib/onboarding/cases";
import { hubspotRepo } from "@/lib/hubspot/repo";
import { requiresFcaFrn, requiresDirectDebit, requiresTuSection } from "@/lib/onboarding/productGroups";
import { assessPrivacyPolicy } from "@/lib/onboarding/privacyAssessment";
import { loadEnrichment } from "@/lib/onboarding/enrich";
import {
  COMPANY_FIELDS, SOCIAL_FIELDS, DPO_FIELDS, PAYMENT_ANSWER_KEYS, INFOSEC_ANSWER_KEYS, projectCompanyAnswers,
  missingCompanyFields, hasValidDpo, isPersonalEmailDomain, requiresTransactionProfile,
  paymentReasonProducts, missingPaymentFields, projectPaymentAnswers, isCharityType, missingInfosecFields, nextFormPage,
  normalizeUrl, URL_ANSWER_KEYS,
} from "./fields";

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
      date_of_birth: mmYYYYtoDate(str(formData.get(`ubo_dob_${i}`))),
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
    // Infosec uploads - best-effort; never fail the submit on an upload error.
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

/** Accept a UBO date of birth as MM/YYYY (Companies House granularity) and store
 *  it as the 1st of that month; pass a full ISO date through for back-compat. */
function mmYYYYtoDate(v: string): string {
  const s = v.trim();
  const m = s.match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1]}-01`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function parseUbos(formData: FormData): UboKycInput[] {
  const count = Number(str(formData.get("ubo_count")) || 0);
  const out: UboKycInput[] = [];
  for (let i = 0; i < count; i++) {
    const ubo_name = str(formData.get(`ubo_name_${i}`));
    if (!ubo_name) continue;
    out.push({
      ubo_id: str(formData.get(`ubo_id_${i}`)) || null,
      ubo_name,
      date_of_birth: mmYYYYtoDate(str(formData.get(`ubo_dob_${i}`))),
      exact_ownership_percent: str(formData.get(`ubo_pct_${i}`)),
      residential_address: {
        line1: str(formData.get(`ubo_addr1_${i}`)), line2: str(formData.get(`ubo_addr2_${i}`)),
        city: str(formData.get(`ubo_city_${i}`)), postcode: str(formData.get(`ubo_postcode_${i}`)), country: str(formData.get(`ubo_country_${i}`)),
      },
      is_pep: str(formData.get(`ubo_pep_${i}`)) === "yes",
      pep_detail: str(formData.get(`ubo_pep_detail_${i}`)),
      consent_given: str(formData.get(`ubo_consent_${i}`)) === "on",
      email: str(formData.get(`ubo_email_${i}`)),
      mobile: str(formData.get(`ubo_mobile_${i}`)),
    });
  }
  return out;
}

const BANK_PURPOSES = new Set(["settlement", "disbursal", "direct_debit"]);
function parseAddBankAccounts(formData: FormData): BankAccountInput[] {
  const count = Math.min(Number(str(formData.get("add_count")) || 0), 10);
  const out: BankAccountInput[] = [];
  for (let i = 0; i < count; i++) {
    const number = str(formData.get(`add_${i}_number`));
    if (!number) continue;
    const p = str(formData.get(`add_${i}_purpose`));
    out.push({
      purpose: (BANK_PURPOSES.has(p) ? p : "disbursal") as BankAccountInput["purpose"],
      account_name: str(formData.get(`add_${i}_name`)), bank_name: str(formData.get(`add_${i}_bank`)),
      sort_code: str(formData.get(`add_${i}_sort`)), account_number: number,
    });
  }
  return out;
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
    // Per-page "last saved by {editor}" marker (covers the typed sections too).
    await setAnswers(db, c.id, [{ field_key: `_page_${page}`, value: "saved" }], ed);
    if (page === "company") {
      const tuCredit = c.product_groups.includes("tu_credit");
      const entries: AnswerInput[] = [];
      for (const f of COMPANY_FIELDS) {
        if (f.onlyIfTuCredit && !tuCredit) continue;
        entries.push({ field_key: f.key, value: str(formData.get(f.key)), is_unknown: str(formData.get(`${f.key}__unknown`)) === "on" });
      }
      for (const s of SOCIAL_FIELDS) entries.push({ field_key: s.key, value: str(formData.get(s.key)) });
      // Custom-rendered fields (not in the flat COMPANY_FIELDS list):
      for (const k of ["trading_address", "trade_body_required", "trade_body", "signatory_name", "signatory_title", "signatory_email"]) {
        entries.push({ field_key: k, value: str(formData.get(k)) });
      }
      const dpoCount = Math.min(Number(str(formData.get("dpo_count")) || 0), 20);
      for (let i = 0; i < dpoCount; i++) {
        for (const d of DPO_FIELDS) entries.push({ field_key: `dpo_${i}_${d.key}`, value: str(formData.get(`dpo_${i}_${d.key}`)) });
      }
      // Normalise URL answers (website / privacy / socials) to include a scheme (item 12).
      for (const e of entries) if (URL_ANSWER_KEYS.includes(e.field_key)) e.value = normalizeUrl(e.value);
      await setAnswers(db, c.id, entries, ed);
      // Keep the typed merchant form in sync so /review, docgen and the privacy
      // assessment read current data.
      const answers = await getAnswers(db, c.id);
      await saveBusinessComplianceSignatory(db, c.id, projectCompanyAnswers(answers));
      if (mode === "continue") {
        const missing = missingCompanyFields(answers, { fcaRequired: requiresFcaFrn(c.product_groups), tuCredit });
        if (!hasValidDpo(answers)) missing.push("Data protection officer");
        const email = answers["email"]?.value ?? "";
        if (missing.length) dest = `${back}?page=company&error=required${qp(v2)}`;
        else if (email && isPersonalEmailDomain(email)) dest = `${back}?page=company&error=email${qp(v2)}`;
        else {
          await setPageComplete(db, c.id, "company", true);
          // Behind the scenes: assess the privacy policy from the provided URL.
          await assessPrivacyPolicy(db, c.id, { id: null, email: "merchant" }).catch(() => {});
          dest = advance();
        }
      }
    } else if (page === "ubos") {
      await saveUboKyc(db, c.id, parseUbos(formData));
      const listComplete = str(formData.get("ubo_list_complete")) === "on";
      await setAnswers(db, c.id, [{ field_key: "ubo_list_complete", value: listComplete ? "yes" : "" }], ed);
      if (mode === "continue") {
        if (!listComplete) dest = `${back}?page=ubos&error=attest${qp(v2)}`;
        else { await setPageComplete(db, c.id, "ubos", true); dest = advance(); }
      }
    } else if (page === "accounts") {
      // Append newly-entered accounts (each CoP-checked); existing ones are kept.
      const toAdd = parseAddBankAccounts(formData);
      if (toAdd.length) await addBankAccounts(db, c.id, toAdd);
      if (mode === "continue") {
        if ((await countBankAccounts(db, c.id)) === 0) dest = `${back}?page=accounts&error=account${qp(v2)}`;
        else { await setPageComplete(db, c.id, "accounts", true); dest = advance(); }
      }
    } else if (page === "payments") {
      const entries: AnswerInput[] = [];
      for (const k of PAYMENT_ANSWER_KEYS) entries.push({ field_key: k, value: str(formData.get(k)), is_unknown: str(formData.get(`${k}__unknown`)) === "on" });
      for (const p of paymentReasonProducts(c.product_groups)) entries.push({ field_key: `reason_${p}`, value: str(formData.get(`reason_${p}`)), is_unknown: str(formData.get(`reason_${p}__unknown`)) === "on" });
      entries.push({ field_key: "dd_signup", value: formData.getAll("dd_signup").map(String).filter(Boolean).join(",") });
      await setAnswers(db, c.id, entries, ed);
      // Bank statement upload (best-effort).
      const stmts = formData.getAll("bank_statement_file").filter((f): f is File => f instanceof File && f.size > 0);
      for (const f of stmts.slice(0, 3)) {
        if (f.size > 20 * 1024 * 1024) continue;
        try { await saveUpload(db, c.id, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }, "bank_statement"); } catch { /* best-effort */ }
      }
      // Project the key DD fields into the typed record for /review + docgen.
      const answers = await getAnswers(db, c.id);
      await saveDirectDebit(db, c.id, projectPaymentAnswers(answers));
      if (mode === "continue") {
        const snap = (await loadEnrichment(db, c.id)).snapshot;
        const missing = missingPaymentFields(answers, {
          transactionProfile: requiresTransactionProfile(c.product_groups),
          directDebit: requiresDirectDebit(c.product_groups),
          charity: isCharityType(snap?.company_type),
          reasonProducts: paymentReasonProducts(c.product_groups),
        });
        if (missing.length) dest = `${back}?page=payments&error=required${qp(v2)}`;
        else { await setPageComplete(db, c.id, "payments", true); dest = advance(); }
      }
    } else if (page === "infosec") {
      const entries: AnswerInput[] = INFOSEC_ANSWER_KEYS.map((k) => ({ field_key: k, value: str(formData.get(k)), is_unknown: str(formData.get(`${k}__unknown`)) === "on" }));
      await setAnswers(db, c.id, entries, ed);
      const uploadGroups: [string, string][] = [
        ["infosec_policy_file", "infosec_policy"], ["pentest_file", "pentest"],
        ["cyber_insurance_file", "cyber_insurance"], ["infosec_files", "infosec"],
      ];
      for (const [fieldName, kind] of uploadGroups) {
        const files = formData.getAll(fieldName).filter((f): f is File => f instanceof File && f.size > 0);
        for (const f of files.slice(0, 5)) {
          if (f.size > 20 * 1024 * 1024) continue;
          try { await saveUpload(db, c.id, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }, kind); } catch { /* best-effort */ }
        }
      }
      if (mode === "continue") {
        const missing = missingInfosecFields(await getAnswers(db, c.id));
        if (missing.length) dest = `${back}?page=infosec&error=required${qp(v2)}`;
        else { await setPageComplete(db, c.id, "infosec", true); dest = advance(); }
      }
    }
  } catch (e) {
    console.error(`[merchant-page-save] ${page} failed for case ${c.id}:`, e);
    failed = true;
  }
  if (failed) redirect(`${back}?page=${page}&error=save${qp(v2)}`);
  redirect(dest);
}

/** Remove one saved bank account from the accounts page. */
export async function removeBankAccountAction(formData: FormData) {
  const token = str(formData.get("token"));
  const v2 = str(formData.get("v2"));
  const accountId = str(formData.get("account_id"));
  const back = `/m/${encodeURIComponent(token)}`;
  const db = serviceClient();
  const c = await getCaseByToken(db, token);
  if (!c) redirect(`${back}?error=token`);
  if (accountId) await removeBankAccount(db, c.id, accountId).catch(() => {});
  redirect(`${back}?page=accounts${qp(v2)}`);
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
  if (answers["ubo_list_complete"]?.value !== "yes") redirect(`${back}?page=ubos&error=attest${qp(v2)}`);
  if (requiresTransactionProfile(c.product_groups) || requiresDirectDebit(c.product_groups)) {
    const snap = (await loadEnrichment(db, c.id)).snapshot;
    const payMissing = missingPaymentFields(answers, {
      transactionProfile: requiresTransactionProfile(c.product_groups),
      directDebit: requiresDirectDebit(c.product_groups),
      charity: isCharityType(snap?.company_type),
      reasonProducts: paymentReasonProducts(c.product_groups),
    });
    if (payMissing.length) redirect(`${back}?page=payments&error=required${qp(v2)}`);
  }
  if (requiresTuSection(c.product_groups) && missingInfosecFields(answers).length) {
    redirect(`${back}?page=infosec&error=required${qp(v2)}`);
  }

  let failed = false;
  try {
    await saveBusinessComplianceSignatory(db, c.id, projectCompanyAnswers(answers));
    const [uboRes, bankRes] = await Promise.all([
      db.from("onboarding_ubo_kyc").select("id", { count: "exact", head: true }).eq("case_id", c.id),
      db.from("onboarding_bank_accounts").select("id", { count: "exact", head: true }).eq("case_id", c.id),
    ]);
    await finalizeMerchantSubmission(db, c.id, { ubos: uboRes.count ?? 0, bankAccounts: bankRes.count ?? 0 });
    // Behind-the-scenes: AI-extract the uploaded infosec docs (age flags,
    // pen-test exec summaries) so ops reviews them ready-analysed.
    await extractPendingUploads(db, c.id).catch(() => {});
    await generateDocsForCase(db, c.id, { id: null, email: "merchant" }, { advanceStatus: false }).catch(() => {});
    await notifyMerchantSubmitted(db, c.id).catch(() => {});
  } catch (e) {
    console.error(`[merchant-submit v2] failed for case ${c.id}:`, e);
    failed = true;
  }
  if (failed) redirect(`${back}?page=review&error=save${qp(v2)}`);
  redirect(`${back}?done=1`);
}
