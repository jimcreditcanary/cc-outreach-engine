// One-off diagnostic — pass a sequence name fragment, get a full report
// of what state it's in and why drafts may not have landed in /queue.
//
//   npm exec tsx scripts/diagnose-sequence.ts "This weeks emails"

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";
import { SEQUENCE_STEPS, dueDateFor } from "../src/lib/sequences/steps";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
const db = createClient(url, key);

const namePattern = process.argv[2];
if (!namePattern) {
  console.error("Usage: tsx scripts/diagnose-sequence.ts <name fragment>");
  process.exit(1);
}

(async () => {
  const { data: seqs, error } = await db
    .from("sequences")
    .select("*")
    .ilike("name", `%${namePattern}%`);
  if (error) { console.error("seq lookup:", error.message); process.exit(1); }
  if (!seqs || seqs.length === 0) {
    console.log(`No sequences matching "${namePattern}".`);
    process.exit(0);
  }

  for (const s of seqs) {
    console.log(`\n━━━ SEQUENCE: ${s.name} (${s.id})`);
    console.log(`status=${s.status}  auto_send=${s.auto_send}  owner_id=${s.owner_id}`);
    console.log(`theme=${(s.theme ?? "").slice(0, 80)}${s.theme && s.theme.length > 80 ? "…" : ""}`);
    console.log(`conference_id=${s.conference_id ?? "—"}`);
    console.log(`created_at=${s.created_at}`);

    // Owner email
    if (s.owner_id) {
      const { data: u } = await db.auth.admin.getUserById(s.owner_id);
      console.log(`owner email: ${u?.user?.email ?? "(unknown)"}`);
    }

    // Contacts in sequence
    const { data: scs } = await db
      .from("sequence_contacts")
      .select(`
        contact_id, current_step, started_at, status,
        contact:contacts(id, full_name, email, organisation_id,
          organisation:organisations(id, name, sector))
      `)
      .eq("sequence_id", s.id);
    const list = (scs ?? []) as unknown as Array<{
      contact_id: string; current_step: number; started_at: string; status: string;
      contact: { id: string; full_name: string | null; email: string | null; organisation_id: string | null; organisation: { id: string; name: string | null; sector: string | null } | { id: string; name: string | null; sector: string | null }[] | null } | null;
    }>;
    console.log(`\nContacts: ${list.length}`);
    for (const sc of list) {
      const c = sc.contact;
      const org = Array.isArray(c?.organisation) ? c?.organisation[0] : c?.organisation;
      const due0 = dueDateFor(new Date(sc.started_at), 0);
      console.log(
        `  - ${c?.full_name ?? "(unnamed)"} <${c?.email ?? "no-email"}> ` +
        `step ${sc.current_step}/${SEQUENCE_STEPS.length} status=${sc.status}\n` +
        `      started_at=${sc.started_at}  step-1 due_at=${due0.toISOString()} (overdue=${due0.getTime() < Date.now()})\n` +
        `      org: ${org?.name ?? "—"} (sector=${org?.sector ?? "—"})  [owner_required: email + linked org + sector]`,
      );
    }

    // Action rows for this sequence
    const { data: actions } = await db
      .from("sequence_actions")
      .select("contact_id, step_index, kind, status, send_id, due_at, created_at")
      .eq("sequence_id", s.id)
      .order("step_index");
    console.log(`\nActions: ${(actions ?? []).length}`);
    for (const a of actions ?? []) {
      console.log(
        `  - contact=${a.contact_id} step=${a.step_index} kind=${a.kind} status=${a.status} ` +
        `send_id=${a.send_id ?? "NULL"} due_at=${a.due_at}`,
      );
    }

    // Sends linked to this sequence
    const { data: sends } = await db
      .from("sends")
      .select("id, contact_id, status, owner_id, subject, ts")
      .eq("sequence_id", s.id)
      .order("ts");
    console.log(`\nSends linked to this sequence: ${(sends ?? []).length}`);
    for (const sd of sends ?? []) {
      console.log(
        `  - send=${sd.id} contact=${sd.contact_id} status=${sd.status} owner=${sd.owner_id} ` +
        `subj="${(sd.subject ?? "").slice(0, 60)}" ts=${sd.ts}`,
      );
    }

    // Diagnosis
    console.log(`\n──── DIAGNOSIS ────`);
    if (s.status !== "live") console.log(`  ❌ Sequence is "${s.status}" — engine only ticks live sequences.`);
    if (list.length === 0) console.log(`  ❌ No contacts added — nothing to advance.`);
    const dueNow = list.filter((sc) => sc.status === "active" && dueDateFor(new Date(sc.started_at), sc.current_step).getTime() <= Date.now());
    console.log(`  ${dueNow.length} contact(s) are currently DUE for their next step.`);
    const missingPieces = list.filter((sc) => {
      const c = sc.contact;
      const org = Array.isArray(c?.organisation) ? c?.organisation[0] : c?.organisation;
      return !c?.email || !org?.id || !org?.sector;
    });
    if (missingPieces.length > 0) {
      console.log(`  ⚠ ${missingPieces.length} contact(s) are MISSING data needed for AI draft generation (email / linked company / company sector):`);
      for (const sc of missingPieces) {
        const c = sc.contact;
        const org = Array.isArray(c?.organisation) ? c?.organisation[0] : c?.organisation;
        const gaps: string[] = [];
        if (!c?.email) gaps.push("no email");
        if (!org?.id) gaps.push("no linked org");
        else if (!org.sector) gaps.push("org has no sector");
        console.log(`     - ${c?.full_name ?? c?.email ?? "(unnamed)"} — ${gaps.join(", ")}`);
      }
    }
    const emailActionsNoSend = (actions ?? []).filter((a) => /send_email_/.test(a.kind) && !a.send_id);
    if (emailActionsNoSend.length > 0) {
      console.log(`  ⚠ ${emailActionsNoSend.length} email action(s) exist with no send_id (silent draft skip from engine).`);
    }
  }
})();
