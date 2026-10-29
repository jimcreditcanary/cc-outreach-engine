// One-time (idempotent) creation of the HubSpot DEAL properties that surface an
// onboarding case's state in HubSpot. Safe to re-run — existing props are
// skipped. Needs a HUBSPOT_TOKEN with crm.schemas.deals.write (to create) and,
// for the app to then WRITE them, crm.objects.deals.write.
//
//   npm run onboarding-setup-props
//
// Until this runs + the deals-write scope is added, syncDealOnboardingStatus()
// simply no-ops — the wizard still works, the status just isn't mirrored to HubSpot.

import { config } from "dotenv";
config({ path: ".env.local", override: true });

interface PropOption { label: string; value: string; displayOrder?: number }
interface PropDef {
  name: string;
  label: string;
  type: "string" | "enumeration";
  fieldType: "text" | "select";
  description: string;
  options?: PropOption[];
}

const STATUS_OPTIONS: PropOption[] = ([
  { value: "started", label: "Started" },
  { value: "internal_complete", label: "Internal complete" },
  { value: "merchant_invited", label: "Merchant invited" },
  { value: "merchant_in_progress", label: "Merchant in progress" },
  { value: "merchant_submitted", label: "Merchant submitted" },
  { value: "ubo_checks", label: "UBO checks" },
  { value: "docs_generated", label: "Docs generated" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "onboarded", label: "Onboarded" },
  { value: "cancelled", label: "Cancelled" },
] as PropOption[]).map((o, i) => ({ ...o, displayOrder: i }));

const PROPS: PropDef[] = [
  {
    name: "onboarding_status",
    label: "Onboarding status",
    type: "enumeration",
    fieldType: "select",
    description: "Merchant onboarding stage, mirrored from the veepveep onboarding wizard.",
    options: STATUS_OPTIONS,
  },
  {
    name: "onboarding_case_id",
    label: "Onboarding case ID",
    type: "string",
    fieldType: "text",
    description: "The veepveep onboarding case id for this deal (internal reference).",
  },
];

async function main() {
  const { hubspotEnabled, hsFetch, HubSpotError } = await import("../src/lib/hubspot/client");
  if (!hubspotEnabled()) {
    console.error("✗ HUBSPOT_TOKEN not set in .env.local.");
    process.exit(1);
  }

  for (const p of PROPS) {
    const label = `deals.${p.name}`;
    try {
      await hsFetch(`/crm/v3/properties/deals/${p.name}`);
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
      await hsFetch(`/crm/v3/properties/deals`, {
        method: "POST",
        body: {
          name: p.name, label: p.label, type: p.type, fieldType: p.fieldType,
          groupName: "dealinformation", description: p.description,
          ...(p.options ? { options: p.options } : {}),
        },
      });
      console.log(`✓ ${label} — created`);
    } catch (e) {
      console.error(`✗ ${label} — create failed: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
  console.log("\nDone. Add crm.objects.deals.write to the token for the app to write these.");
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
