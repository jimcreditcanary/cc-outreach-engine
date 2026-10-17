// One-time (idempotent) creation of the custom HubSpot properties the app
// needs that don't exist natively. Safe to re-run — existing props are skipped.
// Needs a HUBSPOT_TOKEN with crm.schemas.* write scope.
//
//   npm run hubspot-setup-props
//
// See docs/HUBSPOT_MIGRATION.md "Custom properties to create". Company props
// (tier/is_partner/icp/sector) are included but only used once the company
// write path is ported.

import { config } from "dotenv";
config({ path: ".env.local", override: true });

interface PropDef {
  objectType: "contacts" | "companies";
  name: string;
  label: string;
  type: "string" | "number" | "bool" | "enumeration";
  fieldType: "text" | "textarea" | "number" | "booleancheckbox" | "select";
  groupName: string;
  description: string;
  options?: { label: string; value: string }[];
}

const PROPS: PropDef[] = [
  { objectType: "contacts", name: "lead_source", label: "Lead Source", type: "string", fieldType: "text", groupName: "contactinformation", description: "Where this contact came from (whitepaper, website, linkedin…). Set by the outreach engine's lead capture." },
  { objectType: "companies", name: "tier", label: "Tier", type: "number", fieldType: "number", groupName: "companyinformation", description: "Account tier (1 = highest priority)." },
  { objectType: "companies", name: "is_partner", label: "Is Partner", type: "bool", fieldType: "booleancheckbox", groupName: "companyinformation", description: "Whether this company is a referral/introducer partner.", options: [{ label: "Yes", value: "true" }, { label: "No", value: "false" }] },
  { objectType: "companies", name: "icp", label: "ICP", type: "bool", fieldType: "booleancheckbox", groupName: "companyinformation", description: "In the ideal customer profile.", options: [{ label: "Yes", value: "true" }, { label: "No", value: "false" }] },
  { objectType: "companies", name: "context", label: "Context", type: "string", fieldType: "textarea", groupName: "companyinformation", description: "Continuously-updated insight about this company (from their website + news), used by the outreach drafter to personalise emails." },
];

async function main() {
  const { hubspotEnabled, hsFetch, HubSpotError } = await import("../src/lib/hubspot/client");
  if (!hubspotEnabled()) {
    console.error("✗ HUBSPOT_TOKEN not set in .env.local.");
    process.exit(1);
  }

  for (const p of PROPS) {
    const label = `${p.objectType}.${p.name}`;
    try {
      await hsFetch(`/crm/v3/properties/${p.objectType}/${p.name}`);
      console.log(`• ${label} — already exists, skipped`);
      continue;
    } catch (e) {
      if (!(e instanceof HubSpotError) || e.status !== 404) {
        console.error(`✗ ${label} — check failed: ${(e as Error).message}`);
        process.exitCode = 1;
        continue;
      }
    }
    try {
      await hsFetch(`/crm/v3/properties/${p.objectType}`, {
        method: "POST",
        body: {
          name: p.name, label: p.label, type: p.type, fieldType: p.fieldType,
          groupName: p.groupName, description: p.description,
          ...(p.options ? { options: p.options } : {}),
        },
      });
      console.log(`✓ ${label} — created`);
    } catch (e) {
      console.error(`✗ ${label} — create failed: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
