// Field config for the multi-page customer questionnaire (P0). Shared by the
// wizard render (wizard.tsx) and the per-page save (actions.ts) so they can't
// drift. The company page's answers live in onboarding_form_answers (keyed by
// `key`); on submit they're projected back into the typed onboarding_merchant_form
// so /review + docgen keep working.

import type { AnswerMap } from "@/lib/onboarding/formAnswers";
import type { MerchantBusiness, MerchantCompliance, MerchantSignatory, DpoRecord } from "@/lib/onboarding/merchantForm";
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
  { key: "vat_number", label: "VAT number (optional)" },
  { key: "trade_body", label: "Trade-body membership", unknownOk: true },
  { key: "privacy_policy_url", label: "Privacy-policy URL", type: "url", unknownOk: true },
  { key: "signatory_name", label: "Authorised signatory — full name", required: true },
  { key: "signatory_title", label: "Authorised signatory — title / role", required: true },
  { key: "signatory_email", label: "Authorised signatory — email", type: "email", required: true },
];

/** Social media URLs (optional) — answer-store keys. */
export const SOCIAL_FIELDS: { key: string; label: string }[] = [
  { key: "social_facebook", label: "Facebook" },
  { key: "social_linkedin", label: "LinkedIn" },
  { key: "social_twitter", label: "Twitter / X" },
  { key: "social_instagram", label: "Instagram" },
];

/** One DPO's sub-fields (repeatable; stored as dpo_{i}_{key} answer keys). */
export const DPO_FIELDS: { key: keyof DpoRecord; label: string; type?: "text" | "email" | "tel" }[] = [
  { key: "first", label: "First name" },
  { key: "last", label: "Last name" },
  { key: "title", label: "Job title" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
];

/** Collect the structured DPOs out of the flat answer keys (scan up to 20). */
export function collectDpos(answers: AnswerMap): DpoRecord[] {
  const out: DpoRecord[] = [];
  for (let i = 0; i < 20; i++) {
    const g = (s: string) => (answers[`dpo_${i}_${s}`]?.value ?? "").trim();
    const rec: DpoRecord = { first: g("first"), last: g("last"), title: g("title"), email: g("email"), phone: g("phone") };
    if (rec.first || rec.last || rec.email) out.push(rec);
  }
  return out;
}

/** At least one DPO with a name + email (the brief makes DPO required). */
export function hasValidDpo(answers: AnswerMap): boolean {
  return collectDpos(answers).some((d) => (d.first || d.last) && d.email);
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "aol.co.uk",
  "protonmail.com", "proton.me", "gmx.com", "gmx.co.uk", "msn.com", "btinternet.com", "sky.com",
  "mail.com", "zoho.com", "yandex.com", "fastmail.com",
]);

/** True when the email is on a known personal-mailbox domain (brief: the company
 *  email must not be a personal account). */
export function isPersonalEmailDomain(email: string): boolean {
  const at = email.trim().toLowerCase().split("@")[1];
  return !!at && PERSONAL_EMAIL_DOMAINS.has(at);
}

/** Project the company answers back into the typed merchant-form shape so the
 *  internal review + document generation keep reading from one place. */
export function dpoSummary(dpos: DpoRecord[]): string {
  return dpos
    .map((d) => `${[d.first, d.last].filter(Boolean).join(" ")}${d.title ? ` (${d.title})` : ""}${d.email ? ` <${d.email}>` : ""}${d.phone ? ` ${d.phone}` : ""}`.trim())
    .filter(Boolean)
    .join("; ");
}

export function projectCompanyAnswers(answers: AnswerMap): {
  business: MerchantBusiness; compliance: MerchantCompliance; signatory: MerchantSignatory;
} {
  const v = (k: string) => answers[k]?.value ?? "";
  const dpos = collectDpos(answers);
  return {
    business: {
      trading_name: v("trading_name"), trading_address: v("trading_address"), principal_office: v("principal_office"),
      phone: v("phone"), email: v("email"), website: v("website"),
      socials: {
        facebook: v("social_facebook"), linkedin: v("social_linkedin"),
        twitter: v("social_twitter"), instagram: v("social_instagram"),
      },
    },
    compliance: {
      ico_number: v("ico_number"), fca_frn: v("fca_frn"), vat_number: v("vat_number"),
      dpo: dpoSummary(dpos), dpos,
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
