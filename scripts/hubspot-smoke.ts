// HubSpot connectivity + mapping smoke test. Run once the Private App token is
// in .env.local as HUBSPOT_TOKEN:
//
//   npm run hubspot-smoke
//
// Lists a few contacts + companies through the real repository (search →
// association batch → mapping) and reads one contact's detail, so we can see
// the live data flow through the exact code the pages will use. Read-only.

import { config } from "dotenv";
config({ path: ".env.local", override: true });

async function main() {
  // Dynamic import AFTER dotenv so env is populated before modules read it.
  const { hubspotEnabled } = await import("../src/lib/hubspot/client");
  const { hubspotRepo } = await import("../src/lib/hubspot/repo");

  if (!hubspotEnabled()) {
    console.error("✗ HUBSPOT_TOKEN not set in .env.local — create a Private App token first.");
    console.error("  https://app-eu1.hubspot.com/private-apps/9175484");
    process.exit(1);
  }

  console.log("→ listContacts (3, A→Z)…");
  const contacts = await hubspotRepo.listContacts({ limit: 3 });
  console.log(`  total in portal: ${contacts.total}`);
  for (const c of contacts.records) {
    console.log(`  • ${c.full_name} <${c.email ?? "—"}> | ${c.job_title ?? "—"} | ${c.company_name ?? "(no company)"} | ${c.is_new ? "NEW" : c.lead_status ?? "—"}${c.email_guessed ? " [guessed]" : ""}${c.email_bounced ? " [bounced]" : ""}`);
  }

  console.log("\n→ listContacts (new leads only)…");
  const newLeads = await hubspotRepo.listContacts({ newOnly: true, limit: 3 });
  console.log(`  new leads: ${newLeads.total}`);

  console.log("\n→ listCompanies (3, A→Z)…");
  const companies = await hubspotRepo.listCompanies({ limit: 3 });
  console.log(`  total in portal: ${companies.total}`);
  for (const co of companies.records) {
    console.log(`  • ${co.name ?? "—"} | ${co.website ?? "—"} | ${co.industry ?? "—"}`);
  }

  const firstId = contacts.records[0]?.id;
  if (firstId) {
    console.log(`\n→ getContact(${firstId})…`);
    const detail = await hubspotRepo.getContact(firstId);
    console.log(`  ${detail?.full_name} — ${detail?.url}`);
  }

  const firstCompanyId = companies.records[0]?.id;
  if (firstCompanyId) {
    console.log(`\n→ getCompany(${firstCompanyId}) + contacts…`);
    const co = await hubspotRepo.getCompany(firstCompanyId);
    const cos = await hubspotRepo.listCompanyContacts(firstCompanyId, 5);
    console.log(`  ${co?.name} | tier ${co?.tier ?? "—"} | partner ${co?.is_partner} | icp ${co?.icp} | ${cos.length} contact(s)`);
  }

  console.log("\n→ listDeals (3, by amount)…");
  const deals = await hubspotRepo.listDeals({ limit: 3 });
  console.log(`  total in portal: ${deals.total}`);
  for (const d of deals.records) {
    console.log(`  • ${d.name ?? "—"} | ${d.pipeline ?? "—"} › ${d.stage ?? "—"} | ${d.amount ?? "—"} ${d.currency ?? ""}`);
  }

  console.log("\n✓ HubSpot read path works end-to-end.");
}

main().catch((e) => {
  console.error("✗ smoke test failed:", e?.message ?? e);
  process.exit(1);
});
