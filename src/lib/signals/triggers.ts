// Map press signals → the sectors they're relevant to + the angle to take
// (targeting map §6, regulatory triggers). Pure + testable. The generator
// only ever sees signals matched to the contact's sector, and decides for
// itself whether one is genuinely worth leading with.

import type { Sector } from "../import/mappers";

const ALL: Sector[] = [
  "bank",
  "broker",
  "building_society",
  "credit_union",
  "direct_lender",
  "marketplace",
  "sme_lender",
  "utility",
];

export interface Trigger {
  keywords: string[];
  sectors: Sector[];
  note: string;
}

export const TRIGGERS: Trigger[] = [
  {
    keywords: ["consumer duty", "vulnerable customer", "fair value", "outcomes-based"],
    sectors: ALL,
    note: "Consumer Duty — individualised, outcomes-based affordability + proactive support.",
  },
  {
    keywords: ["app fraud", "authorised push payment", "confirmation of payee", "reimbursement"],
    sectors: ["bank", "direct_lender", "marketplace", "building_society"],
    note: "Confirmation of Payee — verify the payee before payout.",
  },
  {
    keywords: ["bnpl", "buy now pay later", "buy-now-pay-later"],
    sectors: ["direct_lender", "marketplace"],
    note: "Get BNPL decisioning regulator-ready (Decide + affordability).",
  },
  {
    keywords: ["credit information", "credit reference", "data sharing", "credit reporting"],
    sectors: ["direct_lender", "bank"],
    note: "Reduce single-CRA dependence (Unify + Open Banking).",
  },
  {
    keywords: ["motor finance", "car finance", "discretionary commission"],
    sectors: ["direct_lender"],
    note: "Car-finance origination + decisioning.",
  },
  {
    keywords: ["cost of living", "arrears", "forbearance", "financial difficulty", "persistent debt"],
    sectors: ALL,
    note: "Proactive pre-arrears intervention (Act + Pay).",
  },
  {
    keywords: ["credit union", "common bond", "co-operative", "mutual"],
    sectors: ["credit_union", "building_society"],
    note: "Modernise decisioning to capture the mutual-sector growth window.",
  },
  {
    keywords: ["mortgage"],
    sectors: ["building_society", "bank"],
    note: "Faster, complex-case mortgage decisioning.",
  },
  {
    keywords: ["open banking", "smart data"],
    sectors: ALL,
    note: "Open Banking-led affordability + income.",
  },
  {
    keywords: ["energy debt", "ofgem", "warm homes", "prepayment"],
    sectors: ["utility"],
    note: "Energy debt + green-finance lending.",
  },
];

export interface SignalInput {
  title: string;
  summary?: string | null;
  link: string;
  source: string;
  ts?: string;
}

export interface MatchedSignal {
  title: string;
  link: string;
  source: string;
  note: string;
}

/**
 * Recent signals relevant to a sector, newest first (input should already be
 * sorted desc). One entry per signal; capped at `max`.
 */
export function matchSignals(signals: readonly SignalInput[], sector: Sector, max = 3): MatchedSignal[] {
  const out: MatchedSignal[] = [];
  for (const s of signals) {
    const hay = `${s.title} ${s.summary ?? ""}`.toLowerCase();
    const trigger = TRIGGERS.find((t) => t.sectors.includes(sector) && t.keywords.some((k) => hay.includes(k)));
    if (!trigger) continue;
    out.push({ title: s.title, link: s.link, source: s.source, note: trigger.note });
    if (out.length >= max) break;
  }
  return out;
}
