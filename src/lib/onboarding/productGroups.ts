// The product groups a merchant can be onboarded for, and everything that
// branches off the selection — the single source of truth for the wizard,
// the merchant form, the checks, and document generation.
//
// WEIGHT drives how much due diligence a case needs:
//   • "full"  → Companies House deep enrichment, UBO chain + ID&V + PEP, infosec,
//               and the heavy documents.
//   • "light" → a basic Companies House check only. No ID, no PEP, no infosec.
//               Open Banking (AIS) and Confirmation of Payee are light: if a case
//               selects ONLY light groups it takes the short path (Jim, 2026-10-29).
//
// If ANY full group is selected the case is a full case (the heavier path wins).

export type ProductGroupKey =
  | "tu_credit"
  | "tu_monevo"
  | "direct_debits"
  | "pay_by_bank"
  | "sweeping_vrp"
  | "cvrp"
  | "faster_payments"
  | "settlement_accounts"
  | "open_banking_data"
  | "confirmation_of_payee";

export type OnboardingWeight = "light" | "full";

export type OnboardingDocKind =
  | "tu_credit_eua"
  | "tu_monevo_eua"
  | "tu_due_diligence_xlsx"
  | "merchant_onboarding_form"
  | "dd_questionnaire";

export interface ProductGroup {
  key: ProductGroupKey;
  label: string;
  weight: OnboardingWeight;
  /** Selecting this force-selects these (and they can't be unticked while it is
   *  set) — Settlement Accounts auto-ticks Faster Payments. */
  autoSelects?: ProductGroupKey[];
  /** Triggers the TU due-diligence / infosec section + a TU End User Agreement. */
  triggersTuSection?: boolean;
  /** Triggers the Disbursal Accounts + Payments Details form pages. */
  triggersPayments?: boolean;
  /** Triggers the Direct Debit sub-form + the DD questionnaire document. */
  triggersDirectDebit?: boolean;
  /** Included in the (single) Merchant Onboarding Form document. */
  inMerchantOnboardingForm?: boolean;
  /** FCA FRN becomes REQUIRED (not optional) when selected — §4.5, TU Credit. */
  requiresFcaFrn?: boolean;
  /** Documents this group contributes to the generated pack. */
  documents?: OnboardingDocKind[];
}

export const PRODUCT_GROUPS: Record<ProductGroupKey, ProductGroup> = {
  tu_credit: {
    key: "tu_credit",
    label: "TU Credit",
    weight: "full",
    triggersTuSection: true,
    requiresFcaFrn: true,
    documents: ["tu_credit_eua", "tu_due_diligence_xlsx"],
  },
  tu_monevo: {
    key: "tu_monevo",
    label: "TU Monevo",
    weight: "full",
    triggersTuSection: true,
    documents: ["tu_monevo_eua", "tu_due_diligence_xlsx"],
  },
  direct_debits: {
    key: "direct_debits",
    label: "Direct Debits",
    weight: "full",
    triggersPayments: true,
    triggersDirectDebit: true,
    inMerchantOnboardingForm: true,
    documents: ["merchant_onboarding_form", "dd_questionnaire"],
  },
  pay_by_bank: {
    key: "pay_by_bank",
    label: "Pay by Bank",
    weight: "full",
    triggersPayments: true,
    inMerchantOnboardingForm: true,
    documents: ["merchant_onboarding_form"],
  },
  sweeping_vrp: {
    key: "sweeping_vrp",
    label: "Sweeping VRP",
    weight: "full",
    triggersPayments: true,
    inMerchantOnboardingForm: true,
    documents: ["merchant_onboarding_form"],
  },
  cvrp: {
    key: "cvrp",
    label: "CVRP",
    weight: "full",
    triggersPayments: true,
    inMerchantOnboardingForm: true,
    documents: ["merchant_onboarding_form"],
  },
  faster_payments: {
    key: "faster_payments",
    label: "Faster Payments",
    weight: "full",
    inMerchantOnboardingForm: true,
    documents: ["merchant_onboarding_form"],
  },
  settlement_accounts: {
    key: "settlement_accounts",
    label: "Settlement Accounts",
    weight: "full",
    autoSelects: ["faster_payments"],
    inMerchantOnboardingForm: true,
    documents: ["merchant_onboarding_form"],
  },
  open_banking_data: {
    key: "open_banking_data",
    label: "Open Banking (AIS)",
    weight: "light",
  },
  // Light-touch, included on Jim's steer that CoP may be sold as a product.
  // If Credit Canary doesn't sell CoP standalone, delete this entry — nothing
  // else references it by key.
  confirmation_of_payee: {
    key: "confirmation_of_payee",
    label: "Confirmation of Payee",
    weight: "light",
  },
};

export const PRODUCT_GROUP_KEYS = Object.keys(PRODUCT_GROUPS) as ProductGroupKey[];

export function isProductGroupKey(v: string): v is ProductGroupKey {
  return v in PRODUCT_GROUPS;
}

/** Apply auto-selection rules and dedupe — the canonical stored selection.
 *  (Settlement Accounts pulls in Faster Payments.) Unknown keys are dropped. */
export function normalizeSelection(keys: string[]): ProductGroupKey[] {
  const set = new Set<ProductGroupKey>();
  for (const k of keys) {
    if (!isProductGroupKey(k)) continue;
    set.add(k);
    for (const auto of PRODUCT_GROUPS[k].autoSelects ?? []) set.add(auto);
  }
  // Preserve catalog order for stable display / storage.
  return PRODUCT_GROUP_KEYS.filter((k) => set.has(k));
}

/** Groups that are force-selected by the current selection and so can't be
 *  unticked in the wizard (e.g. Faster Payments while Settlement is on). */
export function lockedSelections(keys: string[]): Set<ProductGroupKey> {
  const locked = new Set<ProductGroupKey>();
  for (const k of keys) {
    if (!isProductGroupKey(k)) continue;
    for (const auto of PRODUCT_GROUPS[k].autoSelects ?? []) locked.add(auto);
  }
  return locked;
}

const some = (keys: string[], pred: (g: ProductGroup) => boolean | undefined): boolean =>
  keys.some((k) => isProductGroupKey(k) && Boolean(pred(PRODUCT_GROUPS[k])));

/** A case is light-touch only when every selected group is light (and at least
 *  one is selected). Light-touch = basic CH check, no UBO ID&V / PEP / infosec. */
export function isLightTouch(keys: string[]): boolean {
  const valid = keys.filter(isProductGroupKey);
  return valid.length > 0 && valid.every((k) => PRODUCT_GROUPS[k].weight === "light");
}

/** True when the heavier path applies (any full group selected). */
export function requiresFullKyc(keys: string[]): boolean {
  return some(keys, (g) => g.weight === "full");
}

export const requiresTuSection = (keys: string[]) => some(keys, (g) => g.triggersTuSection);
export const requiresPayments = (keys: string[]) => some(keys, (g) => g.triggersPayments);
export const requiresDirectDebit = (keys: string[]) => some(keys, (g) => g.triggersDirectDebit);
export const requiresFcaFrn = (keys: string[]) => some(keys, (g) => g.requiresFcaFrn);
/** UBO/KYC (chain + ID&V + PEP) only on full cases. */
export const requiresUboKyc = (keys: string[]) => requiresFullKyc(keys);

/** Which documents the generated pack contains for a selection. */
export function documentsFor(keys: string[]): OnboardingDocKind[] {
  const docs = new Set<OnboardingDocKind>();
  for (const k of keys) {
    if (!isProductGroupKey(k)) continue;
    for (const d of PRODUCT_GROUPS[k].documents ?? []) docs.add(d);
  }
  return [...docs];
}
