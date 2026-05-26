// Cadence engine (build brief §6). Pure — the clock and tunables are passed
// in, so every rule is unit-testable.
//
// Rules:
//   - One touch per contact per cooldown window (~21–30 days).
//   - Honour snooze_until (set after N touches with no engagement, or far out
//     on a reply so the machine backs off while Jim handles it personally).
//   - Per-company cap so a multi-contact org isn't hit from several angles at
//     once in a single batch.

export const DEFAULT_COOLDOWN_DAYS = 28;
export const DEFAULT_SNOOZE_DAYS = 90;
export const DEFAULT_MAX_TOUCHES_NO_ENGAGE = 3;

export interface ContactCadence {
  last_touched_at: string | null;
  snooze_until: string | null;
}

const DAY_MS = 86_400_000;

/** True if the contact is snoozed past `now`. */
export function isSnoozed(snooze_until: string | null, now: Date): boolean {
  if (!snooze_until) return false;
  const t = new Date(snooze_until).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/** True if the last touch is more recent than `cooldownDays` ago. */
export function withinCooldown(last_touched_at: string | null, now: Date, cooldownDays: number): boolean {
  if (!last_touched_at) return false;
  const t = new Date(last_touched_at).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < cooldownDays * DAY_MS;
}

/** A contact is due if not snoozed and outside the cooldown window. */
export function isDue(c: ContactCadence, now: Date, cooldownDays = DEFAULT_COOLDOWN_DAYS): boolean {
  return !isSnoozed(c.snooze_until, now) && !withinCooldown(c.last_touched_at, now, cooldownDays);
}

/** After N touches with no click/reply, auto-snooze. */
export function shouldSnooze(
  totalTouches: number,
  hasEngaged: boolean,
  maxTouches = DEFAULT_MAX_TOUCHES_NO_ENGAGE,
): boolean {
  return !hasEngaged && totalTouches >= maxTouches;
}

/** ISO timestamp `days` from `now` (for setting snooze_until). */
export function snoozeUntil(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/**
 * Cap how many contacts per company appear in one batch. Order is preserved;
 * rows with no organisation are always kept.
 */
export function applyPerCompanyCap<T extends { organisation_id: string | null }>(
  rows: readonly T[],
  maxPerCompany: number,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const r of rows) {
    if (!r.organisation_id) {
      out.push(r);
      continue;
    }
    const n = counts.get(r.organisation_id) ?? 0;
    if (n >= maxPerCompany) continue;
    counts.set(r.organisation_id, n + 1);
    out.push(r);
  }
  return out;
}
