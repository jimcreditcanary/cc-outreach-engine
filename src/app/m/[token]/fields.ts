// Field config for the multi-page customer questionnaire (P0). Shared by the
// wizard render (wizard.tsx) and the per-page save (actions.ts) so they can't
// drift. The company page's answers live in onboarding_form_answers (keyed by
// `key`); on submit they're projected back into the typed onboarding_merchant_form
// so /review + docgen keep working.

import type { AnswerMap } from "@/lib/onboarding/formAnswers";
import type { MerchantBusiness, MerchantCompliance, MerchantSignatory } from "@/lib/onboarding/merchantForm";
import { requiresPayments, requiresDirectDebit, requiresTuSection } from "@/lib/onboarding/productGroups";

export interface FormPage {
  id: "company" | "ubos" | "accounts" | "payments" | "infosec" | "review";
  label: string;
}

/** The ordered, product-gated page list for a case's questionnaire. */
export function visibleFormPages(groups: string[]): FormPage[] {
  const pages: FormPage[] = [
    { id: "company", label: "Company details" },
    { id: "ubos", label: "Beneficial owners" },
  ];
  if (requiresPayments(groups) || requiresDirectDebit(groups)) pages.push({ id: "accounts", label: "Bank accounts" });
  if (requiresDirectDebit(groups)) pages.push({ id: "payments", label: "Direct Debit" });
  if (requiresTuSection(groups)) pages.push({ id: "infosec", label: "Information security" });
  pages.push({ id: "review", label: "Review & submit" });
  return pages;
}

/** The page after `current` in the gated order (clamped to the last). */
export function nextFormPage(groups: string[], current: string): string {
  const ids = visibleFormPages(groups).map((p) => p.id);
  const i = ids.indexOf(current as FormPage["id"]);
  if (i === -1) return ids[0]!;
  return ids[Math.min(i + 1, ids.length - 1)]!;
}

export interface AnswerFieldDef {
  key: string;
  label: string;
  type?: "text" | "tel" | "email" | "url";
  required?: boolean;
  /** FCA FRN is only required when a TU product is selected. */
  requiredIfFca?: boolean;
  /** Only show/collect for TU Credit (principal office). */
  onlyIfTuCredit?: boolean;
  /** Offer the "don't know — ask later" toggle. */
  unknownOk?: boolean;
}

export const COMPANY_FIELDS: AnswerFieldDef[] = [
  { key: "trading_name", label: "Trading name(s)", required: true },
  { key: "trading_address", label: "Trading address", required: true },
  { key: "principal_office", label: "Principal office address", onlyIfTuCredit: true },
  { key: "phone", label: "Company telephone", type: "tel", required: true },
  { key: "email", label: "Company email", type: "email", required: true },
  { key: "website", label: "Company website", type: "url", required: true },
  { key: "ico_number", label: "ICO registration number", required: true, unknownOk: true },
  { key: "fca_frn", label: "FCA registration number (FRN)", requiredIfFca: true },
  { key: "dpo", label: "Data protection officer", unknownOk: true },
  { key: "trade_body", label: "Trade-body membership", unknownOk: true },
  { key: "privacy_policy_url", label: "Privacy-policy URL", type: "url", unknownOk: true },
  { key: "signatory_name", label: "Authorised signatory — full name", required: true },
  { key: "signatory_title", label: "Authorised signatory — title / role", required: true },
  { key: "signatory_email", label: "Authorised signatory — email", type: "email", required: true },
];

/** Project the company answers back into the typed merchant-form shape so the
 *  internal review + document generation keep reading from one place. */
export function projectCompanyAnswers(answers: AnswerMap): {
  business: MerchantBusiness; compliance: MerchantCompliance; signatory: MerchantSignatory;
} {
  const v = (k: string) => answers[k]?.value ?? "";
  return {
    business: {
      trading_name: v("trading_name"), trading_address: v("trading_address"), principal_office: v("principal_office"),
      phone: v("phone"), email: v("email"), website: v("website"),
    },
    compliance: {
      ico_number: v("ico_number"), fca_frn: v("fca_frn"), dpo: v("dpo"),
      privacy_policy_url: v("privacy_policy_url"), trade_body: v("trade_body"),
    },
    signatory: { name: v("signatory_name"), title: v("signatory_title"), email: v("signatory_email") },
  };
}

/** Required company fields that are empty and not marked "don't know". */
export function missingCompanyFields(answers: AnswerMap, opts: { fcaRequired: boolean; tuCredit: boolean }): string[] {
  const missing: string[] = [];
  for (const f of COMPANY_FIELDS) {
    if (f.onlyIfTuCredit && !opts.tuCredit) continue;
    const required = f.required || (f.requiredIfFca && opts.fcaRequired);
    if (!required) continue;
    const a = answers[f.key];
    if (a?.is_unknown) continue; // don't-know satisfies (deferred to economic buyer)
    if (!(a?.value ?? "").trim()) missing.push(f.label);
  }
  return missing;
}
