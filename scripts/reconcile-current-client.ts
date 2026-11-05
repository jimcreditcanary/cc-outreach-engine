// One-off (idempotent) reconcile of the HubSpot `current_client` property to the
// local Active-Customer flag (feedback item 8a). The local flag
// (crm_customer_flags.is_customer, set by the "Mark as Active Customer" button)
// is the source of truth; this makes the HubSpot column agree:
//   • a flagged company that isn't current_client=true  → set true
//   • a company that is current_client=true but NOT flagged → set false
// Companies that were never set stay empty (they read as "not a current client")
// — we deliberately do NOT write `false` to every record, to avoid a mass write
// that could trigger HubSpot workflows.
//
// Dry run by default (no writes). Add --apply to perform the reconcile; it
// snapshots the prior state to scripts/.reconcile-current-client.snapshot.json
// first (reversible).
//
//   npx tsx scripts/reconcile-current-client.ts            # dry run
//   npx tsx scripts/reconcile-current-client.ts --apply    # apply

import { config } from "dotenv";
import { writeFileSync } from "node:fs";
config({ path: ".env.local", override: true });

async function main() {
  const apply = process.argv.includes("--apply");
  const { hubspotEnabled } = await import("../src/lib/hubspot/client");
  if (!hubspotEnabled()) { console.error("✗ HUBSPOT_TOKEN not set in .env.local"); process.exit(1); }
  const { listCustomerCompanies, bulkUpdateCompanies } = await import("../src/lib/hubspot/repo");
  const { serviceClient } = await import("../src/lib/db/client");
  const { listCustomerCompanyIds } = await import("../src/lib/crm/customer");

  const flagged = new Set(await listCustomerCompanyIds(serviceClient()));
  const currentlyYes = await listCustomerCompanies(1000);
  const yesSet = new Set(currentlyYes.map((c) => c.id));

  const toYes = [...flagged].filter((id) => !yesSet.has(id));              // flagged but not Yes in HubSpot
  const toNo = currentlyYes.filter((c) => !flagged.has(c.id)).map((c) => c.id); // Yes in HubSpot but not flagged

  console.log(`Local Active-Customer flags (source of truth): ${flagged.size}`);
  console.log(`HubSpot current_client=true right now:          ${yesSet.size}`);
  console.log(`→ will SET YES (flagged, not yet Yes):          ${toYes.length}`);
  console.log(`→ will SET NO  (Yes in HubSpot, not flagged):   ${toNo.length}`);
  if (toNo.length) console.log(`   un-flagging: ${currentlyYes.filter((c) => !flagged.has(c.id)).map((c) => c.name || c.id).slice(0, 20).join(", ")}${toNo.length > 20 ? " …" : ""}`);
  console.log(`   already correct, untouched:                  ${yesSet.size - toNo.length} Yes + every empty record`);

  if (!apply) { console.log("\nDry run — no changes made. Re-run with --apply to perform the reconcile."); return; }

  const snapshotPath = "scripts/.reconcile-current-client.snapshot.json";
  writeFileSync(snapshotPath, JSON.stringify({
    at: new Date().toISOString(),
    priorCurrentlyYes: currentlyYes.map((c) => ({ id: c.id, name: c.name })),
    setYes: toYes, setNo: toNo,
  }, null, 2));
  console.log(`\nSnapshot written to ${snapshotPath} (reversible).`);

  const wroteYes = toYes.length ? await bulkUpdateCompanies(toYes, { current_client: true }) : 0;
  const wroteNo = toNo.length ? await bulkUpdateCompanies(toNo, { current_client: false }) : 0;
  console.log(`\n✓ Applied. Set Yes: ${wroteYes}. Set No: ${wroteNo}. HubSpot current_client now matches the local flag.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
