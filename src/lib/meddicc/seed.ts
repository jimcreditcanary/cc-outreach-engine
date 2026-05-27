// MEDDICC seeding (build brief §5/§8). For a T1 deal (open + proposal),
// populate the MEDDICC layer from the proposal + CRM notes, find the single
// biggest gap, and surface ONE next-best-action paired with the buyer-facing
// question that closes it. Internal analysis — no anonymisation needed.

import { z } from "zod";
import { generateStructured } from "../ai/claude";

export const MEDDICC_KEYS = [
  "metrics",
  "economic_buyer",
  "decision_criteria",
  "decision_process",
  "identified_pain",
  "champion",
  "competition",
] as const;
export type MeddiccKey = (typeof MEDDICC_KEYS)[number];

const Component = z.object({
  text: z.string(),
  filled: z.boolean(),
});

export const MeddiccSchema = z.object({
  metrics: Component,
  economic_buyer: Component,
  decision_criteria: Component,
  decision_process: Component,
  identified_pain: Component,
  champion: Component,
  competition: Component,
  biggest_gap: z.enum(MEDDICC_KEYS),
  next_best_action: z.string(),
  buyer_question: z.string(),
});
export type MeddiccResult = z.infer<typeof MeddiccSchema>;

const SYSTEM = `You are a B2B sales strategist working MEDDICC on a live deal for
Credit Canary (a UK credit-decisioning + payments platform). You are given a
proposal and CRM notes. Populate each MEDDICC element from what's there:

- metrics — the economic impact / success metrics the buyer cares about
- economic_buyer — who controls the budget / signs off
- decision_criteria — what they'll judge the decision on
- decision_process — the steps/timeline to a decision
- identified_pain — the concrete pain driving the deal
- champion — the internal advocate
- competition — incumbent / alternatives (incl. "do nothing")

For each: text = what's known (or "" if nothing), filled = true only if it's
genuinely well-understood, not merely mentioned. Then identify the SINGLE
biggest gap (the element most missing and most load-bearing for closing),
the next best action to close that gap, and ONE concrete buyer-facing
question Jim can ask to fill it (e.g. economic-buyer gap → "Besides yourself,
who'd sign off on a decision this size?"). One action, not a checklist.`;

export async function seedMeddicc(proposalText: string, notes: string[]): Promise<MeddiccResult> {
  const user = `PROPOSAL:\n${proposalText.slice(0, 12000)}\n\nCRM NOTES:\n${
    notes.length ? notes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(none)"
  }`;
  return generateStructured({
    system: SYSTEM,
    user,
    schema: MeddiccSchema,
    effort: "medium",
    maxTokens: 3000,
    cacheSystem: true,
  });
}
