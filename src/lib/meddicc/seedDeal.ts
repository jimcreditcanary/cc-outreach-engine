// Seed MEDDICC for a single deal — shared by the `npm run meddicc` batch
// script and the automatic seed that fires when a proposal is uploaded.

import { serviceClient } from "../db/client";
import { seedMeddicc } from "./seed";

type DB = ReturnType<typeof serviceClient>;

/** Populate the MEDDICC layer + next-best-action for one deal. No-op if the
 *  deal has no proposal text yet. Returns the biggest gap, or null if skipped. */
export async function seedDealMeddicc(db: DB, dealId: string): Promise<string | null> {
  const { data: deal } = await db
    .from("deals")
    .select("id, organisation_id, proposal_text, proposal_exists")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal || !deal.proposal_exists || !deal.proposal_text) return null;

  const { data: notes } = await db
    .from("notes")
    .select("content")
    .eq("organisation_id", deal.organisation_id)
    .order("noted_at", { ascending: false })
    .limit(5);

  const m = await seedMeddicc(
    String(deal.proposal_text),
    (notes ?? []).map((n) => String(n.content)).filter(Boolean),
  );
  const next_best_action = `[gap: ${m.biggest_gap}] ${m.next_best_action}\n\nAsk: "${m.buyer_question}"`;

  const { error } = await db
    .from("deals")
    .update({
      meddicc_metrics: m.metrics.text || null,
      meddicc_metrics_filled: m.metrics.filled,
      meddicc_economic_buyer: m.economic_buyer.text || null,
      meddicc_economic_buyer_filled: m.economic_buyer.filled,
      meddicc_decision_criteria: m.decision_criteria.text || null,
      meddicc_decision_criteria_filled: m.decision_criteria.filled,
      meddicc_decision_process: m.decision_process.text || null,
      meddicc_decision_process_filled: m.decision_process.filled,
      meddicc_identified_pain: m.identified_pain.text || null,
      meddicc_identified_pain_filled: m.identified_pain.filled,
      meddicc_champion: m.champion.text || null,
      meddicc_champion_filled: m.champion.filled,
      meddicc_competition: m.competition.text || null,
      meddicc_competition_filled: m.competition.filled,
      next_best_action,
    })
    .eq("id", dealId);
  if (error) throw error;
  return m.biggest_gap;
}
