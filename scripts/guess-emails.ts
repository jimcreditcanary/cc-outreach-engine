// Guess missing contact emails from the email convention of their colleagues.
//
//   npx tsx scripts/guess-emails.ts                 # dry run, ALL companies
//   npx tsx scripts/guess-emails.ts --event <id>    # only companies tied to an event's attendees
//   npx tsx scripts/guess-emails.ts --min-agree 2   # require >=2 colleagues to agree on the pattern
//   npx tsx scripts/guess-emails.ts --apply         # actually write (needs migration 037)
//
// For each company with at least one known corporate email, we infer the
// address convention (first.last, flast, …) and apply it to colleagues with
// no email. Every guess is flagged email_guessed=true + email_status set to
// 'unverified' and logged to the contact timeline. Guesses NEVER overwrite an
// existing address and are skipped if the generated address already exists.
//
// Dry run prints exactly what it would do and writes nothing.

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inferConvention, guessEmail, type Sample } from "../src/lib/contacts/emailGuess";

const APPLY = process.argv.includes("--apply");
const argVal = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const EVENT_ID = argVal("--event") ?? null;
const MIN_AGREE = Number(argVal("--min-agree") ?? "1");

interface ContactRow {
  id: string;
  full_name: string | null;
  email: string | null;
  email_guessed: boolean | null;
  organisation_id: string | null;
  organisation: { name: string | null } | null;
}

async function loadAllContacts(db: SupabaseClient): Promise<ContactRow[]> {
  // Pre-migration the email_guessed column doesn't exist; the dry run still
  // needs to work, so fall back to a select without it (treating all as not
  // guessed — there are none yet anyway).
  const rich = "id, full_name, email, email_guessed, organisation_id, organisation:organisations(name)";
  const base = "id, full_name, email, organisation_id, organisation:organisations(name)";
  const probe = await db.from("contacts").select(rich).limit(1);
  const cols = probe.error && /email_guessed/.test(probe.error.message) ? base : rich;

  const out: ContactRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("contacts")
      .select(cols)
      .not("organisation_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as ContactRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Org ids tied to a given event/conference via its attendees. */
async function orgIdsForEvent(db: SupabaseClient, eventId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from("conference_attendances")
    .select("contact:contacts(organisation_id)")
    .eq("conference_id", eventId);
  if (error) throw error;
  const ids = new Set<string>();
  for (const r of (data ?? []) as unknown as { contact: { organisation_id: string | null } | null }[]) {
    if (r.contact?.organisation_id) ids.add(r.contact.organisation_id);
  }
  return ids;
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Apply needs the marker column. Fail loudly with the fix rather than
  // silently writing emails we can't flag as guesses.
  if (APPLY) {
    const probe = await db.from("contacts").select("email_guessed").limit(1);
    if (probe.error) {
      console.error("✗ Can't --apply: the contacts.email_guessed column is missing.");
      console.error("  Run migration 037 in the Supabase SQL editor first, then re-run with --apply.");
      process.exit(1);
    }
  }

  const eventOrgIds = EVENT_ID ? await orgIdsForEvent(db, EVENT_ID) : null;
  const all = await loadAllContacts(db);

  // Global lowercase email set — used to avoid generating a colliding address.
  const takenEmails = new Set(all.map((c) => (c.email ?? "").trim().toLowerCase()).filter(Boolean));

  // Group by org.
  const byOrg = new Map<string, ContactRow[]>();
  for (const c of all) {
    if (!c.organisation_id) continue;
    if (eventOrgIds && !eventOrgIds.has(c.organisation_id)) continue;
    (byOrg.get(c.organisation_id) ?? byOrg.set(c.organisation_id, []).get(c.organisation_id)!).push(c);
  }

  let companiesWithPattern = 0;
  let companiesSkippedNoPattern = 0;
  const guesses: { id: string; org: string; name: string; email: string; pattern: string; from: number }[] = [];
  const collisions: string[] = [];

  for (const [, rows] of byOrg) {
    const orgName = rows.find((r) => r.organisation?.name)?.organisation?.name ?? "(unnamed)";
    const samples: Sample[] = rows
      .filter((r) => r.email && !r.email_guessed)
      .map((r) => ({ full_name: r.full_name, email: r.email! }));
    const targets = rows.filter((r) => !r.email && r.full_name);
    if (samples.length === 0 || targets.length === 0) continue;

    const conv = inferConvention(samples);
    if (!conv || conv.agree < MIN_AGREE) { companiesSkippedNoPattern++; continue; }
    companiesWithPattern++;

    for (const t of targets) {
      const guess = guessEmail(t.full_name, conv);
      if (!guess) continue;
      if (takenEmails.has(guess.toLowerCase())) { collisions.push(`${t.full_name} → ${guess} (already exists, skipped)`); continue; }
      takenEmails.add(guess.toLowerCase());
      guesses.push({ id: t.id, org: orgName, name: t.full_name ?? "?", email: guess, pattern: conv.pattern, from: conv.agree });
    }
  }

  // ── Report ────────────────────────────────────────────────────────
  console.log(`\nScope: ${EVENT_ID ? `event ${EVENT_ID} (${eventOrgIds?.size ?? 0} companies)` : "ALL companies"}`);
  console.log(`Companies scanned: ${byOrg.size} · with a usable pattern: ${companiesWithPattern} · no clear pattern: ${companiesSkippedNoPattern}`);
  console.log(`Guesses: ${guesses.length}${collisions.length ? ` · skipped ${collisions.length} collisions` : ""}\n`);

  const byCompany = new Map<string, typeof guesses>();
  for (const g of guesses) (byCompany.get(g.org) ?? byCompany.set(g.org, []).get(g.org)!).push(g);
  let shown = 0;
  for (const [org, gs] of byCompany) {
    if (shown >= 60) { console.log(`… and ${guesses.length - shown} more`); break; }
    console.log(`${org}  [${gs[0]!.pattern}, from ${gs[0]!.from} colleague${gs[0]!.from === 1 ? "" : "s"}]`);
    for (const g of gs) {
      if (shown >= 60) break;
      console.log(`   ${g.name}  →  ${g.email}`);
      shown++;
    }
  }
  if (collisions.length) {
    console.log(`\nCollisions skipped (first 10):`);
    for (const c of collisions.slice(0, 10)) console.log(`   ${c}`);
  }

  if (!APPLY) {
    console.log(`\n(DRY RUN — nothing written. Re-run with --apply to save these ${guesses.length} guesses.)`);
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────
  let written = 0;
  for (const g of guesses) {
    const { error } = await db
      .from("contacts")
      .update({ email: g.email, email_guessed: true, email_status: "unverified" })
      .eq("id", g.id)
      .is("email", null); // guard: never overwrite if an email appeared since the scan
    if (error) { console.error(`  ✗ ${g.name}: ${error.message}`); continue; }
    await db.from("events").insert({
      contact_id: g.id,
      type: "crm_change",
      payload: { kind: "email_guessed", message: `📧 Email guessed from ${g.org} pattern (${g.pattern}): ${g.email} — unverified` },
      source: "guess-emails",
    });
    written++;
  }
  console.log(`\n✓ Wrote ${written} guessed emails (flagged email_guessed, status unverified).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
