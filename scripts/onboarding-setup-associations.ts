// One-time (idempotent) creation of the deal↔contact association LABELS used to
// mirror onboarding stakeholder roles into HubSpot. Safe to re-run — existing
// labels are skipped. Needs a HUBSPOT_TOKEN with association write scope
// (crm.objects.deals.write + the associations schema write).
//
//   npm run onboarding-setup-associations
//
// Until this runs + the scope is added, associateDealContactRole() no-ops — the
// wizard still records roles in its own DB regardless.

import { config } from "dotenv";
config({ path: ".env.local", override: true });

// Must match the ONBOARDING_ROLES labels in src/lib/onboarding/cases.ts.
const ROLE_LABELS = ["Authorised signatory", "Economic buyer", "Procurement", "Finance", "Compliance", "Technical / product"];

interface LabelsRes { results?: { category: string; label: string | null }[] }

async function main() {
  const { hubspotEnabled, hsFetch } = await import("../src/lib/hubspot/client");
  if (!hubspotEnabled()) {
    console.error("✗ HUBSPOT_TOKEN not set in .env.local.");
    process.exit(1);
  }

  let have = new Set<string>();
  try {
    const existing = await hsFetch<LabelsRes>("/crm/v4/associations/deals/contacts/labels");
    have = new Set((existing.results ?? []).filter((r) => r.category === "USER_DEFINED" && r.label).map((r) => r.label!.toLowerCase()));
  } catch (e) {
    console.error(`✗ Couldn't list existing labels: ${(e as Error).message}`);
    process.exit(1);
  }

  for (const label of ROLE_LABELS) {
    if (have.has(label.toLowerCase())) { console.log(`• ${label} — already exists, skipped`); continue; }
    try {
      await hsFetch("/crm/v4/associations/deals/contacts/labels", {
        method: "POST",
        body: { label, name: label.toLowerCase().replace(/[^a-z0-9]+/g, "_") },
      });
      console.log(`✓ ${label} — created`);
    } catch (e) {
      console.error(`✗ ${label} — ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
  console.log("\nDone. Needs crm.objects.deals.write + associations schema write on the token.");
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
