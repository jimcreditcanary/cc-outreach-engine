// Central suppression writer. The suppressions table's unique index is on the
// EXPRESSION lower(email), not the plain column, so a PostgREST
// `.upsert(..., { onConflict: "email" })` fails ("no unique or exclusion
// constraint matching the ON CONFLICT specification") and — because callers
// swallowed the error — bounces/complaints/opt-outs were silently NOT being
// suppressed. This check-then-write avoids onConflict entirely and is
// case-insensitive, so both mailers (Supabase + HubSpot) get real protection.

import type { serviceClient } from "./db/client";

type DB = ReturnType<typeof serviceClient>;

export interface SuppressInput {
  email: string;
  reason: string; // suppression_reason enum: hard_bounce | complaint | unsubscribe | manual | …
  contact_id?: string | null;
  note?: string | null;
  why?: string | null;
  recontact_at?: string | null;
}

export async function addSuppression(
  db: DB,
  input: SuppressInput,
  opts: { updateIfExists?: boolean } = {},
): Promise<void> {
  const email = input.email.trim();
  if (!email) return;

  const row: Record<string, unknown> = {
    reason: input.reason,
    contact_id: input.contact_id ?? null,
    note: input.note ?? null,
  };
  if (input.why !== undefined) row.why = input.why;
  if (input.recontact_at !== undefined) row.recontact_at = input.recontact_at;

  const { data: existing } = await db.from("suppressions").select("id").ilike("email", email).maybeSingle();
  if (existing) {
    // Already suppressed. Only overwrite when the caller wants to (e.g. an
    // unsubscribe form resubmit updating recontact preference); webhooks just
    // ensure the address stays suppressed and leave the original reason.
    if (opts.updateIfExists) {
      const { error } = await db.from("suppressions").update(row).eq("id", (existing as { id: string }).id);
      if (error) console.error("suppress update:", error.message);
    }
    return;
  }

  const { error } = await db.from("suppressions").insert({ email, ...row });
  if (error && !/duplicate key|unique/i.test(error.message)) console.error("suppress insert:", error.message);
}
