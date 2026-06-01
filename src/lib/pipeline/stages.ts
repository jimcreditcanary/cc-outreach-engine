// Single source of truth for sales-pipeline stages + their win probabilities.
//
// Probabilities drive the weighted forecast on the dashboard. Defaults are
// the standard MEDDICC/SaaS-sales waterfall; tweak here if a stage starts
// closing systematically above/below its weight (signal that the probability
// is wrong, not the deals).
//
// Nurture is parked, hence very low; Closed Won = 100; Closed Lost = 0.

export const STAGES = [
  "Identify",
  "Qualify / Discovery",
  "Develop",
  "Commit",
  "Nurture",
  "Closed Won",
  "Closed Lost",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_PROBABILITY: Record<Stage, number> = {
  "Identify": 0.10,
  "Qualify / Discovery": 0.25,
  "Develop": 0.50,
  "Commit": 0.75,
  "Nurture": 0.05,
  "Closed Won": 1.00,
  "Closed Lost": 0.00,
};

/** % string for table headers / chips. */
export function stageProbabilityLabel(s: string): string {
  const p = STAGE_PROBABILITY[s as Stage];
  return p === undefined ? "—" : `${Math.round(p * 100)}%`;
}

/** Numeric weight for a stage. Unknown stages default to 0 (don't count
 *  toward the weighted forecast — keeps the number honest). */
export function stageProbability(s: string | null | undefined): number {
  if (!s) return 0;
  return STAGE_PROBABILITY[s as Stage] ?? 0;
}
