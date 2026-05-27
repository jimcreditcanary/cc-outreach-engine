// Seed MEDDICC for T1 deals (build brief §8). For each open deal with a
// proposal, populate the MEDDICC layer and set ONE next-best-action + the
// buyer-facing question. Surfaced on /t1. Re-run after attaching proposals.
//
//   npm run meddicc

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { seedMeddicc } from "../src/lib/meddicc/seed";

config({ path: ".env.local", override: true });

async function main() {
  const db = serviceClient();
  const { data: deals, error } = await db
    .from("deals")
    .select("id, title, organisation_id, proposal_text")
    .eq("status", "open")
    .eq("proposal_exists", true);
  if (error) throw error;

  if (!deals || deals.length === 0) {
    console.log("No T1 deals (open + proposal). Attach proposals first: npm run import-proposals");
    return;
  }
  console.log(`Seeding MEDDICC for ${deals.length} T1 deal(s)…`);

  for (const d of deals) {
    const { data: notes } = await db
      .from("notes")
      .select("content")
      .eq("organisation_id", d.organisation_id)
      .order("noted_at", { ascending: false })
      .limit(5);

    const m = await seedMeddicc(
      String(d.proposal_text ?? ""),
      (notes ?? []).map((n) => String(n.content)).filter(Boolean),
    );

    const nextBestAction = `[gap: ${m.biggest_gap}] ${m.next_best_action}\n\nAsk: "${m.buyer_question}"`;

    const { error: upErr } = await db
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
        next_best_action: nextBestAction,
      })
      .eq("id", d.id);
    if (upErr) throw upErr;
    console.log(`  ${d.title}: gap=${m.biggest_gap}`);
  }
  console.log("Done. Review at /t1.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
