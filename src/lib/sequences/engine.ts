// Sequence engine — turns time + sequence_contacts state into actions.
//
// Called by the hourly cron + on-demand from server actions. For each
// active sequence_contact, looks at their current_step and decides:
//
//   - if the step's due date has passed AND no action row exists yet →
//     create the action. For email steps, also generate an AI draft and
//     wire send.sequence_id so reply-handling can later flip the
//     contact's status to 'replied'.
//   - if the previous action is `done` → advance current_step and recurse.
//   - if current_step is past the end → mark sequence_contact 'completed'.
//
// Pure-ish: takes a Supabase client + does the writes. No side-effects
// outside the DB so it's safe to re-run.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SEQUENCE_STEPS, dueDateFor, isEmailStep, type Step } from "./steps";
import { regenerateForContact } from "../generate/forContact";

export interface AdvanceResult {
  considered: number;
  actionsCreated: number;
  draftsQueued: number;
  contactsCompleted: number;
  errors: string[];
}

/** Tick the engine forward for every active sequence-contact across all
 *  live sequences. Idempotent — re-running won't duplicate actions (unique
 *  (sequence_id, contact_id, step_index) on sequence_actions). */
export async function advanceAllSequences(db: SupabaseClient): Promise<AdvanceResult> {
  const result: AdvanceResult = { considered: 0, actionsCreated: 0, draftsQueued: 0, contactsCompleted: 0, errors: [] };

  // Only act on contacts whose parent sequence is live (not paused).
  const { data: rows, error } = await db
    .from("sequence_contacts")
    .select(`
      sequence_id, contact_id, current_step, started_at, status,
      sequence:sequences!inner(id, status, owner_id, auto_send),
      contact:contacts!inner(id, email, owner_id)
    `)
    .eq("status", "active")
    .eq("sequence.status", "live")
    .limit(5000);
  if (error) { result.errors.push(`load: ${error.message}`); return result; }

  type Row = {
    sequence_id: string;
    contact_id: string;
    current_step: number;
    started_at: string;
    status: string;
    sequence: { id: string; status: string; owner_id: string | null; auto_send: boolean } | { id: string; status: string; owner_id: string | null; auto_send: boolean }[] | null;
    contact: { id: string; email: string | null; owner_id: string | null } | { id: string; email: string | null; owner_id: string | null }[] | null;
  };
  const list = (rows ?? []) as Row[];
  const pick = <T>(v: T | T[] | null): T | null => v ? (Array.isArray(v) ? (v[0] ?? null) : v) : null;

  for (const row of list) {
    result.considered++;
    try {
      const seq = pick(row.sequence);
      const ct = pick(row.contact);
      if (!seq || !ct) continue;

      // Past the end → mark sequence-contact as completed.
      if (row.current_step >= SEQUENCE_STEPS.length) {
        await db.from("sequence_contacts").update({ status: "completed" })
          .eq("sequence_id", row.sequence_id).eq("contact_id", row.contact_id);
        result.contactsCompleted++;
        continue;
      }

      const step = SEQUENCE_STEPS[row.current_step]!;
      const startedAt = new Date(row.started_at);
      const due = dueDateFor(startedAt, row.current_step);
      if (due.getTime() > Date.now()) continue; // not yet

      // Check whether an action already exists (idempotency on re-runs).
      const { data: existing } = await db
        .from("sequence_actions")
        .select("id, status, send_id")
        .eq("sequence_id", row.sequence_id)
        .eq("contact_id", row.contact_id)
        .eq("step_index", row.current_step)
        .maybeSingle();

      if (existing) {
        // If the existing action is done, advance to the next step + recurse-ish
        // (cron's next tick will pick up the new step).
        if (existing.status === "done") {
          await db.from("sequence_contacts").update({
            current_step: row.current_step + 1,
            last_advanced_at: new Date().toISOString(),
          }).eq("sequence_id", row.sequence_id).eq("contact_id", row.contact_id);
        }
        continue;
      }

      // Create the action row. For email steps, also queue an AI draft.
      const owner_id = seq.owner_id;
      // auto_send=true → land as 'approved' (cron ships in next window).
      // auto_send=false → land as 'queued' (operator reviews in /queue).
      const sendStatus: "approved" | "queued" = seq.auto_send ? "approved" : "queued";
      let send_id: string | null = null;
      if (isEmailStep(step) && ct.email) {
        try {
          const draft = await regenerateForContact(db, row.contact_id);
          if (draft) {
            // Look up asset_id from URL (mirrors generateDraftForContact).
            const { data: asset } = await db.from("content_assets").select("id").eq("url", draft.asset_url).maybeSingle();
            const { data: inserted } = await db.from("sends").insert({
              contact_id: row.contact_id,
              angle: draft.angle,
              asset_id: asset?.id ?? null,
              subject: draft.subject,
              body_html: draft.body_html,
              body_text: draft.body_text,
              original_body_text: draft.body_text,
              status: sendStatus,
              owner_id,
              sequence_id: row.sequence_id,
            }).select("id").single();
            send_id = (inserted?.id as string | null) ?? null;
            result.draftsQueued++;
          }
        } catch (e) {
          result.errors.push(`draft for ${row.contact_id} step ${row.current_step}: ${(e as Error).message}`);
        }
      }

      const { error: insErr } = await db.from("sequence_actions").insert({
        sequence_id: row.sequence_id,
        contact_id: row.contact_id,
        step_index: row.current_step,
        kind: step.kind,
        due_at: due.toISOString(),
        status: "pending",
        send_id,
        owner_id,
      });
      if (insErr) { result.errors.push(`action insert: ${insErr.message}`); continue; }
      result.actionsCreated++;
    } catch (e) {
      result.errors.push(`row ${row.sequence_id}/${row.contact_id}: ${(e as Error).message}`);
    }
  }

  return result;
}
