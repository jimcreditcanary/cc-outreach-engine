// Label display helpers — turn snake_case / kebab-case enum values into
// title-case for the UI. Stored values stay snake_case for the AI prompts +
// matching logic; only the rendered label is normalised.

// Tokens that should render as all-caps (or a fixed casing) rather than
// title-case, so "sme_lender" → "SME Lender", "icp" → "ICP".
const ACRONYMS: Record<string, string> = {
  sme: "SME", icp: "ICP", psc: "PSC", ubo: "UBO", cop: "CoP",
  kyc: "KYC", cdd: "CDD", aml: "AML", vat: "VAT", ltd: "Ltd",
  llp: "LLP", plc: "PLC", uk: "UK", ai: "AI", crm: "CRM", b2b: "B2B",
};

/** Normalise any stored enum/tag value to a human label:
 *  "direct_lender" → "Direct Lender", "active-proposal-to-strike-off" →
 *  "Active Proposal To Strike Off", "sme_lender" → "SME Lender". */
export function humanizeLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? (w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** Sector-specific alias (kept for existing call sites). */
export function formatSector(raw: string | null | undefined): string {
  return humanizeLabel(raw);
}

// Single source of truth for the lender sector enum. Previously duplicated
// inline across /companies, /companies/[id], /meetings/[id] and /linkedin.
export const SECTORS = [
  "bank", "broker", "building_society", "credit_union",
  "direct_lender", "marketplace", "sme_lender", "utility",
] as const;

export type Sector = (typeof SECTORS)[number];

/** {value, label} pairs for a <select>, with normalised display labels. */
export function sectorOptions(): { value: string; label: string }[] {
  return SECTORS.map((s) => ({ value: s, label: humanizeLabel(s) }));
}
