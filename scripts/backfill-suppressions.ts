// Backfill the suppression list from historical signals that were never
// recorded, because the suppression upsert was silently failing (see
// src/lib/suppress.ts). Sources:
//   A. contacts.email_status = 'bounced'        → hard_bounce
//   B. events type='complaint' (→ contact email) → complaint
//   C. events type='reply' whose body is an opt-out → unsubscribe
//
// Dry-run by default (prints what it WOULD add). Re-run with --apply to write.
// Idempotent — addSuppression skips addresses already suppressed.
//
//   npm run backfill-suppressions           # dry run
//   npm run backfill-suppressions -- --apply

import { config } from "dotenv";
config({ path: ".env.local", override: true });

const APPLY = process.argv.includes("--apply");

interface Cand { reason: string; contact_id: string | null; note: string }

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const { addSuppression } = await import("../src/lib/suppress");
  const { isUnsubscribe } = await import("../src/lib/cadence/reply");
  const db = serviceClient();

  const cand = new Map<string, Cand>();
  const add = (email: string | null | undefined, reason: string, contact_id: string | null, note: string) => {
    const e = (email ?? "").trim().toLowerCase();
    if (!e.includes("@")) return;
    if (!cand.has(e)) cand.set(e, { reason, contact_id, note });
  };

  // A. Bounced contacts (the webhook set email_status even though suppression failed).
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data } = await db.from("contacts").select("id, email").eq("email_status", "bounced").range(from, from + PAGE - 1);
    const rows = (data ?? []) as { id: string; email: string | null }[];
    for (const r of rows) add(r.email, "hard_bounce", r.id, "backfill: email_status=bounced");
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  // B. Complaint events → contact email.
  {
    const { data } = await db.from("events").select("contact_id, contact:contacts(email)").eq("type", "complaint").limit(10000);
    for (const r of (data ?? []) as unknown as { contact_id: string | null; contact: { email: string | null } | null }[]) {
      add(r.contact?.email, "complaint", r.contact_id, "backfill: complaint");
    }
  }

  // C. Reply opt-outs (from address + body matches isUnsubscribe).
  {
    const { data } = await db.from("events").select("payload").eq("type", "reply").limit(10000);
    for (const r of (data ?? []) as unknown as { payload: { from?: string; text_body?: string } | null }[]) {
      const p = r.payload;
      if (p?.from && isUnsubscribe(p.text_body ?? "")) add(p.from, "unsubscribe", null, "backfill: reply opt-out");
    }
  }

  // Subtract already-suppressed (for an accurate preview; addSuppression also guards).
  const { data: supp } = await db.from("suppressions").select("email");
  const existing = new Set((supp ?? []).map((s) => String((s as { email: string }).email).toLowerCase()));
  const toAdd = [...cand.entries()].filter(([e]) => !existing.has(e));

  const byReason: Record<string, number> = {};
  for (const [, v] of toAdd) byReason[v.reason] = (byReason[v.reason] ?? 0) + 1;

  console.log(`Historical candidates: ${cand.size}`);
  console.log(`Already suppressed:    ${cand.size - toAdd.length}`);
  console.log(`To add:                ${toAdd.length}`);
  console.log(`  by reason: ${JSON.stringify(byReason)}`);

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to write.");
    return;
  }

  let n = 0;
  for (const [email, v] of toAdd) {
    await addSuppression(db, { email, reason: v.reason, contact_id: v.contact_id, note: v.note });
    if (++n % 100 === 0) console.log(`  …${n}/${toAdd.length}`);
  }
  console.log(`\n✓ Added ${n} suppressions.`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
