// Classify a creditcanary.co.uk URL into a content_assets type + the
// tags we can derive deterministically from the URL structure. Semantic
// tagging (problem lanes, case-study sectors) is layered on later by the
// targeting-map pass — this stays pure and URL-only so it's testable.

import type { Sector } from "../import/mappers";

export type ContentType = "case_study" | "article" | "module" | "data_product";

export interface Classification {
  type: ContentType | null;
  tags_sector: Sector[];
  tags_module: string[];
}

// /audience/<slug>.html → sector enum.
const SECTOR_BY_AUDIENCE: Record<string, Sector> = {
  banks: "bank",
  brokers: "broker",
  "building-societies": "building_society",
  "credit-unions": "credit_union",
  "direct-lenders": "direct_lender",
  marketplaces: "marketplace",
  "sme-lenders": "sme_lender",
  utilities: "utility",
};

/** Path segments of a URL, ".html" stripped, empties removed. */
function segments(url: string): string[] {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* already a path */
  }
  return path
    .replace(/\.html$/i, "")
    .split("/")
    .filter(Boolean);
}

export function classify(url: string): Classification {
  const seg = segments(url);
  const [top, second] = seg;
  const result: Classification = { type: null, tags_sector: [], tags_module: [] };

  if (top === "case-studies" && second) {
    // /case-studies/<client> — an index lives at /resources/case-studies.
    result.type = "case_study";
  } else if (top === "resources" && second === "blog" && seg[2]) {
    result.type = "article";
  } else if (top === "use-cases" && second) {
    // Capability / problem pages — closest enum fit is article.
    result.type = "article";
  } else if (top === "platform" && second) {
    result.type = "module";
    result.tags_module = [second];
  } else if (top === "connect" && second) {
    result.type = "data_product";
  } else if (top === "audience" && second) {
    const sector = SECTOR_BY_AUDIENCE[second];
    if (sector) result.tags_sector = [sector];
    // Sector landing page — useful context, but not a sendable asset type.
  }

  return result;
}
