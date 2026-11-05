// Field config for the multi-page customer questionnaire (P0). Shared by the
// wizard render (wizard.tsx) and the per-page save (actions.ts) so they can't
// drift. The company page's answers live in onboarding_form_answers (keyed by
// `key`); on submit they're projected back into the typed onboarding_merchant_form
// so /review + docgen keep working.

import type { AnswerMap } from "@/lib/onboarding/formAnswers";
import type { MerchantBusiness, MerchantCompliance, MerchantSignatory, DpoRecord, DirectDebitDetails } from "@/lib/onboarding/merchantForm";
import { PRODUCT_GROUPS, requiresPayments, requiresDirectDebit, requiresTuSection } from "@/lib/onboarding/productGroups";

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
  if (requiresTransactionProfile(groups) || requiresDirectDebit(groups)) pages.push({ id: "payments", label: "Payment details" });
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
  /** Offer the "don't know - ask later" toggle. */
  unknownOk?: boolean;
  /** Optional helper link shown under the field (e.g. "Find your number"). */
  help?: { url: string; label: string };
}

// Trading address + signatory are rendered as custom blocks in CompanyPage
// (same-as-registered toggle / Postcoder lookup; existing-contact picker), so
// they're not in this flat text-field list. FRN is optional (not required).
export const COMPANY_FIELDS: AnswerFieldDef[] = [
  { key: "trading_name", label: "Trading name(s)", required: true },
  { key: "principal_office", label: "Principal office address", onlyIfTuCredit: true },
  { key: "phone", label: "Company telephone", type: "tel", required: true },
  { key: "email", label: "Company email", type: "email", required: true },
  { key: "website", label: "Company website", type: "url", required: true },
  { key: "ico_number", label: "ICO registration number", required: true, unknownOk: true, help: { url: "https://ico.org.uk/esdwebpages/search", label: "Find your number" } },
  { key: "fca_frn", label: "FCA registration number (FRN) (optional)" },
  { key: "vat_number", label: "VAT number (optional)" },
  { key: "privacy_policy_url", label: "Privacy-policy URL", type: "url", unknownOk: true },
];

/** HTML validation attributes for an input type (phone + URL). Phone accepts an
 *  international number (+44 7700 900123, with or without a space/hyphen) OR a UK
 *  local number (07700 900123) — more forgiving than requiring a space (item 5).
 *  Placeholder uses Ofcom's reserved fictional range, not a real number. */
export const PHONE_PATTERN = "(\\+\\d{1,3}[\\s-]?\\d[\\d\\s-]{5,15}|0\\d{2,4}[\\s-]?\\d[\\d\\s-]{4,10})";
export const PHONE_TITLE = "Enter a valid phone number, e.g. +44 7700 900123 or 07700 900123";
export const PHONE_PLACEHOLDER = "+44 7700 900123";
export function inputValidation(type?: string): { inputMode?: "tel" | "url"; pattern?: string; title?: string; placeholder?: string } {
  if (type === "tel") return { inputMode: "tel", pattern: PHONE_PATTERN, title: PHONE_TITLE, placeholder: PHONE_PLACEHOLDER };
  if (type === "url") return { inputMode: "url" };
  return {};
}

/** Normalise a URL answer: prepend https:// when a scheme is missing, so the
 *  website/privacy/social fields store a usable URL (item 12). Empty stays empty. */
export function normalizeUrl(v: string): string {
  const s = v.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
}

/** Answer keys that hold URLs and should be normalised on save (item 12). */
export const URL_ANSWER_KEYS = [
  "website", "privacy_policy_url",
  "social_facebook", "social_linkedin", "social_twitter", "social_instagram",
];

/** Social media URLs (optional) - answer-store keys. */
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

/** Collect the structured DPOs out of the flat answer keys (scan up to 20). A
 *  DPO can be a person (first/last) or a company (item 3). */
export function collectDpos(answers: AnswerMap): DpoRecord[] {
  const out: DpoRecord[] = [];
  for (let i = 0; i < 20; i++) {
    const g = (s: string) => (answers[`dpo_${i}_${s}`]?.value ?? "").trim();
    const kind: "person" | "company" = g("kind") === "company" ? "company" : "person";
    const rec: DpoRecord = { kind, company: g("company"), first: g("first"), last: g("last"), title: g("title"), email: g("email"), phone: g("phone") };
    const has = kind === "company" ? (rec.company || rec.email) : (rec.first || rec.last || rec.email);
    if (has) out.push(rec);
  }
  return out;
}

/** At least one valid DPO (person needs a name + email; company needs a company
 *  name + email). DPO is required. */
export function hasValidDpo(answers: AnswerMap): boolean {
  return collectDpos(answers).some((d) => d.kind === "company" ? !!(d.company && d.email) : !!((d.first || d.last) && d.email));
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
    .map((d) => d.kind === "company"
      ? `${d.company ?? ""} (company)${d.email ? ` <${d.email}>` : ""}${d.phone ? ` ${d.phone}` : ""}`.trim()
      : `${[d.first, d.last].filter(Boolean).join(" ")}${d.title ? ` (${d.title})` : ""}${d.email ? ` <${d.email}>` : ""}${d.phone ? ` ${d.phone}` : ""}`.trim())
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
  // Custom-rendered required fields (not in the flat COMPANY_FIELDS list):
  const req = (key: string, label: string) => {
    if (answers[key]?.is_unknown) return;
    if (!(answers[key]?.value ?? "").trim()) missing.push(label);
  };
  req("trading_address", "Trading address");
  req("signatory_name", "Authorised signatory - full name");
  req("signatory_title", "Authorised signatory - title / role");
  req("signatory_email", "Authorised signatory - email");
  return missing;
}

// ─── Payment details page (P4) ───────────────────────────────────────────────

const TRANSACTION_PROFILE_PRODUCTS = new Set(["communications", "pay_by_bank", "sweeping_vrp", "cvrp"]);
/** The transaction-profile block shows for Communications / Pay-by-Bank / VRP / CVRP. */
export function requiresTransactionProfile(groups: string[]): boolean {
  return groups.some((g) => TRANSACTION_PROFILE_PRODUCTS.has(g));
}

const PAYMENT_PRODUCTS_FOR_REASON = new Set(["communications", "pay_by_bank", "sweeping_vrp", "cvrp", "faster_payments", "settlement_accounts", "direct_debits"]);
/** Selected products that need a per-type "why did you choose this" reason. */
export function paymentReasonProducts(groups: string[]): string[] {
  return groups.filter((g) => PAYMENT_PRODUCTS_FOR_REASON.has(g));
}
export function productLabel(key: string): string {
  return PRODUCT_GROUPS[key as keyof typeof PRODUCT_GROUPS]?.label ?? key;
}

/** Best-effort: the Companies House type marks it a charity (gates Gift Aid). */
export function isCharityType(companyType: string | null | undefined): boolean {
  return /charit/i.test(companyType ?? "");
}

/** Static payment answer keys (reason_{product} and dd_signup are handled separately). */
export const PAYMENT_ANSWER_KEYS = [
  "pay_bank_statement", "pay_bank_statement_reason", "pay_take_payments_for", "pay_expected_volume",
  "pay_avg_value", "pay_max_value", "pay_b2b_b2c", "pay_b2b_pct", "pay_b2c_pct", "pay_collect_method",
  "dd_has_sun", "dd_sun_number", "dd_sun_provider", "dd_branded_sun_ok", "dd_statement_display",
  "dd_transfer", "dd_max_collection_limit", "dd_frequency", "dd_frequency_other", "dd_frequency_split",
  "dd_before_after", "dd_schedule", "dd_collection_dates", "dd_advance_notice", "dd_auto_represent", "dd_gift_aid",
];

export function missingPaymentFields(answers: AnswerMap, opts: {
  transactionProfile: boolean; directDebit: boolean; charity: boolean; reasonProducts: string[];
}): string[] {
  const miss: string[] = [];
  const need = (key: string, label: string) => { if (answers[key]?.is_unknown) return; if (!(answers[key]?.value ?? "").trim()) miss.push(label); };
  if (opts.transactionProfile) {
    need("pay_bank_statement", "Recent bank statement (yes/no)");
    need("pay_take_payments_for", "What you take payments for");
    need("pay_expected_volume", "Expected monthly volume");
    need("pay_avg_value", "Average transaction value");
    need("pay_max_value", "Maximum transaction value");
    need("pay_b2b_b2c", "B2B / B2C");
    need("pay_collect_method", "How you collect payments + provider");
    for (const p of opts.reasonProducts) need(`reason_${p}`, `Reason for ${productLabel(p)}`);
  }
  if (opts.directDebit) {
    need("dd_has_sun", "Active SUN (yes/no)");
    need("dd_transfer", "Direct Debit transfer (all/partial)");
    need("dd_max_collection_limit", "Max collection limit per customer/month");
    need("dd_frequency", "Collection frequency");
    need("dd_before_after", "Collect before/after service");
    if (!(answers["dd_signup"]?.value ?? "").trim()) miss.push("Direct Debit sign-up method");
    need("dd_schedule", "Schedule type");
    need("dd_collection_dates", "Collection date(s)");
    need("dd_advance_notice", "Advance-notice method");
    need("dd_auto_represent", "Auto-representment (yes/no)");
    if (opts.charity) need("dd_gift_aid", "Gift Aid (yes/no)");
  }
  return miss;
}

/** Project the key DD answers into the typed onboarding_direct_debit record so
 *  /review + docgen keep working; the full set lives in the answer store. */
export function projectPaymentAnswers(answers: AnswerMap): DirectDebitDetails {
  const v = (k: string) => answers[k]?.value ?? "";
  return {
    collects_dd: v("dd_has_sun"),
    existing_sun: v("dd_sun_number"),
    payment_description: v("pay_take_payments_for"),
    expected_monthly_volume: v("pay_expected_volume"),
    average_value: v("pay_avg_value"),
  };
}

// ─── Infosec / TU questionnaire page (P5) ────────────────────────────────────

const INFOSEC_TOP_YN = [
  "infosec_cmc_pi", "infosec_search_type_ok", "infosec_shared_email", "infosec_ico_notice",
  "infosec_data_transfer", "infosec_industry_body", "infosec_membership_valid",
  "infosec_iso27001", "infosec_pci", "infosec_soc2", "infosec_iso27001_intending", "infosec_align_other",
];
const INFOSEC_TEXT = [
  "infosec_iso27001_expiry", "infosec_iso27001_assessor", "infosec_pci_expiry", "infosec_pci_assessor",
  "infosec_soc2_expiry", "infosec_soc2_assessor", "infosec_align_detail", "infosec_align_explain",
];

/** ≤10-employee (small business) security questions: [key, label]. */
export const INFOSEC_SMALL: ReadonlyArray<readonly [string, string]> = [
  ["s_antivirus", "Antivirus installed + host-based intrusion detection (HIDS)?"],
  ["s_own_login", "Employees using the TU product have their own username/password?"],
  ["s_password_policy", "Enforce minimum password requirements (14 chars + 3 of specials/upper/numeric)?"],
  ["s_router", "Router default settings changed in the last 3 months?"],
  ["s_mfa", "Enforce multi-factor authentication to access emails?"],
  ["s_defender", "Windows Defender + auto-update active (if using Windows)?"],
  ["s_personal_devices", "Are employees allowed to use personal devices to access your data?"],
  ["s_vpn", "Require a VPN to access company data?"],
  ["s_removable_media", "Prevent external hard drives / USB / removable media?"],
];
/** >10-employee (large business) security questions: [key, label]. */
export const INFOSEC_LARGE: ReadonlyArray<readonly [string, string]> = [
  ["l_infosec_policy", "Documented Information Security Policy (standards, passwords, wireless, incident response)?"],
  ["l_training", "Annual security-awareness training with testing / attestation?"],
  ["l_antivirus", "Up-to-date antivirus + HIDS on all servers and workstations?"],
  ["l_logging", "Systems configured to log errors, security events, login attempts?"],
  ["l_personal_devices", "Are employees allowed to use personal devices to access your data?"],
  ["l_vpn", "Require a VPN to access company data?"],
  ["l_patching", "Regular, prompt patching (7 days emergency, 14 days critical)?"],
  ["l_encryption_256", "Minimum 256-bit encryption for TU data before it leaves your environment?"],
  ["l_pentest", "Annual penetration testing of all internet-facing applications/systems?"],
  ["l_cyber_insurance", "Maintain Cyber Insurance coverage?"],
];

export const INFOSEC_ANSWER_KEYS = [
  ...INFOSEC_TOP_YN, "infosec_over_10",
  ...INFOSEC_SMALL.map(([k]) => k), ...INFOSEC_LARGE.map(([k]) => k),
  ...INFOSEC_SMALL.map(([k]) => `${k}_explain`), ...INFOSEC_LARGE.map(([k]) => `${k}_explain`),
  ...INFOSEC_TEXT, "l_encryption_detail",
];

export function missingInfosecFields(answers: AnswerMap): string[] {
  const miss: string[] = [];
  const val = (k: string) => (answers[k]?.value ?? "").trim();
  const need = (k: string, label: string) => { if (answers[k]?.is_unknown) return; if (!val(k)) miss.push(label); };
  need("infosec_cmc_pi", "CMC / PI firm?");
  need("infosec_search_type_ok", "Search type in keeping with business?");
  need("infosec_shared_email", "Shared email account?");
  need("infosec_ico_notice", "ICO enforcement / decision notice?");
  need("infosec_data_transfer", "Data transfer outside UK/EEA?");
  need("infosec_industry_body", "Industry-body membership required?");
  if (val("infosec_industry_body") === "yes") need("infosec_membership_valid", "Membership valid & current?");
  for (const [cert, label] of [["iso27001", "ISO 27001"], ["pci", "PCI DSS"], ["soc2", "SOC2"]] as const) {
    need(`infosec_${cert}`, `${label}?`);
    if (val(`infosec_${cert}`) === "yes") { need(`infosec_${cert}_expiry`, `${label} expiry date`); need(`infosec_${cert}_assessor`, `${label} assessor`); }
  }
  need("infosec_iso27001_intending", "Intending ISO 27001?");
  need("infosec_align_other", "Other security arrangements?");
  if (val("infosec_align_other") === "yes") need("infosec_align_detail", "Security arrangements detail");
  if (val("infosec_align_other") === "no") need("infosec_align_explain", "Security arrangements explanation");
  need("infosec_over_10", "More than 10 employees?");
  const over = val("infosec_over_10");
  if (over === "no") for (const [k, l] of INFOSEC_SMALL) need(k, l);
  else if (over === "yes") { for (const [k, l] of INFOSEC_LARGE) need(k, l); need("l_encryption_detail", "Encryption standards detail"); }
  return miss;
}
