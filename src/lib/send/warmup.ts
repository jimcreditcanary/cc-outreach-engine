// Warm-up ramp (build brief §8): start low, climb to the daily cap over the
// first weeks (e.g. 10 → 20 → 35 → 50). Pure.

/** Parse "10,20,35,50" → [10,20,35,50]. */
export function parseRamp(spec: string): number[] {
  return spec
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** Daily cap for a given warm-up day index (clamps to the final step). */
export function dailyCap(ramp: number[], dayIndex: number): number {
  if (ramp.length === 0) return 0;
  const i = Math.max(0, Math.min(dayIndex, ramp.length - 1));
  return ramp[i]!;
}

/** Whole calendar days between a start date and now (>= 0). */
export function daysSince(startISO: string | undefined, now: Date): number {
  if (!startISO) return 0;
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return 0;
  const ms = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
