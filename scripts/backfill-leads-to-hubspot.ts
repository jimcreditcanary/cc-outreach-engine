// One-off backfill: push Supabase `new` leads (captured before the HubSpot
// cutover, so stranded out of the live app) up into HubSpot as contacts.
// Idempotent: matches by email, never duplicates. Dry-run by default — writes
// nothing until --live. Does NOT notify or enqueue follow-ups (these are old
// leads); it just gets them into HubSpot so they're visible + workable.
//
//   npm run backfill-leads                       # dry-run: show the plan
//   npm run backfill-leads -- --live             # create/link in HubSpot
//   npm run backfill-leads -- --live --create-companies   # also create missing companies

import { config } from "dotenv";
config({ path: ".env.local", override: true });

const LIVE = process.argv.includes("--live");
const CREATE_COMPANIES = process.argv.includes("--create-companies");
const OWNER_ID = process.env.HUBSPOT_LEAD_OWNER_ID ?? "86510668";

type Org = { name: string | null };
type Lead = {
  id: string; full_name: string | null; email: string | null; job_title: string | null;
  mobile: string | null; lead_source: string | null; created_at: string | null;
  organisation: Org | Org[] | null;
};
const orgName = (l: Lead): string | null => {
  const o = Array.isArray(l.organisation) ? l.organisation[0] : l.organisation;
  return o?.name ?? null;
};

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const { findContactByEmail, findCompanyByName, createCompany, hubspotRepo } = await import("../src/lib/hubspot/repo");
  const db = serviceClient();

  const { data } = await db
    .from("contacts")
    .select("id, full_name, email, job_title, mobile, lead_source, created_at, organisation:organisations(name)")
    .eq("status", "new")
    .not("email", "is", null)
    .order("created_at", { ascending: true });
  const leads = (data ?? []) as Lead[];

  console.log(`\n${LIVE ? "LIVE" : "DRY-RUN"} · ${leads.length} Supabase 'new' lead(s) to reconcile with HubSpot\n`);

  let created = 0, linked = 0, existed = 0, companiesCreated = 0, failed = 0;
  for (const l of leads) {
    const email = (l.email ?? "").trim().toLowerCase();
    const co = orgName(l);
    try {
      const hs = await findContactByEmail(email);
      if (hs) {
        existed++;
        console.log(`  = exists    ${l.full_name ?? "—"} <${email}>  → ${hs.url}`);
        continue;
      }
      // Resolve company (link; optionally create).
      let companyId: string | null = null;
      if (co) {
        const found = await findCompanyByName(co);
        companyId = found?.id ?? null;
        if (!companyId && CREATE_COMPANIES && LIVE) {
          companyId = (await createCompany({ name: co, owner_id: OWNER_ID })).id;
          companiesCreated++;
        }
      }
      if (!LIVE) {
        created++;
        console.log(`  + create    ${l.full_name ?? "—"} <${email}>  · ${l.lead_source ?? "—"}  · ${co ?? "—"}${companyId ? " (link)" : co ? " (company not in HubSpot)" : ""}`);
        continue;
      }
      const c = await hubspotRepo.createContact({
        full_name: l.full_name ?? email,
        email,
        job_title: l.job_title?.trim() || null,
        mobile: l.mobile?.trim() || null,
        is_new: true,
        lead_source: l.lead_source ?? "supabase-backfill",
        company_id: companyId,
        owner_id: OWNER_ID,
      });
      if (companyId) linked++;
      created++;
      console.log(`  + created   ${l.full_name ?? "—"} <${email}>  → ${c.url}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ failed    <${email}>: ${(e as Error).message}`);
    }
  }

  console.log(`\n${LIVE ? "Done" : "Would"}: ${created} create${LIVE ? "d" : ""}, ${existed} already in HubSpot, ${linked} company-linked, ${companiesCreated} companies created, ${failed} failed.`);
  if (!LIVE) console.log("Re-run with --live to apply (add --create-companies to create missing companies).");
}

main().catch((e) => { console.error("✗", (e as Error)?.message ?? e); process.exit(1); });
