// Tier derivation (build prompt §5).
//
// Tier is DERIVED on import and cached on the organisation — never
// hand-tagged. An org rolls up to the state of its hottest deal:
//
//   T1 — active deal:  an OPEN deal that has a proposal. The machine
//        does NOT auto-send to T1; it runs the MEDDICC nudge layer.
//   T2 — lapsed deal:  a CLOSED (won/lost) or stale deal that has a
//        proposal, and no open-with-proposal deal. The re-engagement
//        sweet spot.
//   T3 — no proposal:  no deal carries a proposal. Content/capability
//        nurture until the contact raises a hand.
//
// Pure function so it can be unit-tested without a DB and reused by both
// the importer and any re-derivation job.

export type Tier = 1 | 2 | 3;

export interface DealTierInput {
  status: "open" | "won" | "lost";
  proposal_exists: boolean;
}

/**
 * Roll an org's deals up to its tier. An org with no deals (or no
 * proposal on any deal) is T3.
 */
export function deriveTier(deals: readonly DealTierInput[]): Tier {
  const hasOpenProposal = deals.some((d) => d.status === "open" && d.proposal_exists);
  if (hasOpenProposal) return 1;

  const hasAnyProposal = deals.some((d) => d.proposal_exists);
  if (hasAnyProposal) return 2;

  return 3;
}
