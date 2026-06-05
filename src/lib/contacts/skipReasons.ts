// Curated skip reasons for the LinkedIn-card "Skip + reason" control.
// Kept in a plain (non-"use server") module so the constant can be
// imported into client/server-rendered pages without breaking the
// Next.js rule that "use server" files only export async functions.

export const SKIP_REASONS = [
  "Current customer",
  "Not interested right now",
  "Not a fit (wrong role / sector)",
  "Left the company",
  "Competitor",
  "Asked to be removed",
  "Other",
] as const;

export type SkipReason = typeof SKIP_REASONS[number];
