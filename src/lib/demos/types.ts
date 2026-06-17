// Client-safe demo types + constants (no server imports — safe to pull into
// the wizard's client bundle).

export const PRODUCT_TYPES = [
  "Consumer - Unsecured Loan",
  "Consumer - Secured Loan",
  "Consumer - Car Loan",
  "Consumer - Mortgage",
  "Consumer - Credit Card",
  "SME - Asset Finance",
  "SME - Unsecured Loan",
  "SME - Credit Card",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export interface Branding {
  /** Normalised company URL we profiled. */
  company_url: string;
  /** Best-guess logo (external URL or null). */
  logo_url: string | null;
  /** Other logo candidates found on the page, so the operator can pick. */
  logo_candidates: string[];
  /** Brand background colour as a hex string. */
  bg_color: string;
  tone: string;
  product_type: ProductType;
  /** Short pitch copy for the landing page's left side. */
  description: string;
}
