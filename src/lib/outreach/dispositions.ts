// Outreach workflow dispositions (migration 065). When a drafted email is
// discarded the operator records why + what happens to the contact. The draft
// workflow reads the active set to skip contacts it should no longer draft.
//
// - disqualified → hard, permanent (also mirrored into suppressions elsewhere)
// - removed      → out of the automated workflow, permanent, still a lead
// - snoozed      → skipped until snooze_until, then re-enters naturally
//
// All of it degrades gracefully if migration 065 hasn't run yet (the table just
// isn't there) — recording no-ops and the active set comes back empty.

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export type Disposition = "disqualified" | "removed" | "snoozed";

export interface DispositionInput {
  hsContactId: string;
  email: string | null;
  disposition: Disposition;
  reason: string | null;
  /** Only for "snoozed": when the contact should re-enter outreach. */
  snoozeUntil?: Date | null;
  userId: string | null;
}

export async function recordDisposition(db: DB, input: DispositionInput): Promise<void> {
  try {
    await db.from("outreach_dispositions").insert({
      hs_contact_id: input.hsContactId,
      email: input.email,
      disposition: input.disposition,
      reason: input.reason,
      snooze_until: input.snoozeUntil ? input.snoozeUntil.toISOString() : null,
      created_by: input.userId,
    });
  } catch { /* table not present yet — disposition is best-effort audit */ }
}

/** HubSpot contact ids the draft workflow must skip: everyone disqualified or
 *  removed, plus anyone currently snoozed (snooze_until in the future). An
 *  expired snooze no longer blocks. */
export async function blockedContactIds(db: DB): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { data } = await db
      .from("outreach_dispositions")
      .select("hs_contact_id, disposition, snooze_until");
    const now = Date.now();
    for (const r of (data ?? []) as { hs_contact_id: string; disposition: Disposition; snooze_until: string | null }[]) {
      if (r.disposition === "disqualified" || r.disposition === "removed") {
        out.add(r.hs_contact_id);
      } else if (r.disposition === "snoozed" && r.snooze_until && new Date(r.snooze_until).getTime() > now) {
        out.add(r.hs_contact_id);
      }
    }
  } catch { /* table not present yet — nothing blocked */ }
  return out;
}

/** now + whole months, clamped to a sane range. */
export function monthsFromNow(months: number): Date {
  const n = Math.min(Math.max(Math.round(months), 1), 24);
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
}
