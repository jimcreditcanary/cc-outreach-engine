// Attach proposal text to deals (build brief §5). Drop proposal files in
// inputs/proposals/ named by org (e.g. "Snugg.md"). Matches the org, attaches
// the text to its best deal (open preferred), flips proposal_exists, and
// re-derives tiers — which is what turns deals into T1/T2.
//
//   npm run import-proposals
//
// .txt / .md only (convert PDFs to text first).

import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { deriveTier, type DealTierInput } from "../src/lib/tier/derive";

config({ path: ".env.local", override: true });

const DIR = "inputs/proposals";

async function main() {
  const db = serviceClient();
  let files: string[];
  try {
    files = readdirSync(DIR).filter((f) => /\.(txt|md)$/i.test(f));
  } catch {
    console.error(`No ${DIR}/ directory.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.log(`No .txt/.md proposals in ${DIR}/.`);
    return;
  }

  const affectedOrgs = new Set<string>();
  let attached = 0;

  for (const file of files) {
    const key = basename(file, extname(file)).trim();
    const text = readFileSync(join(DIR, file), "utf8");

    const { data: org } = await db.from("organisations").select("id, name").ilike("name", key).maybeSingle();
    if (!org) {
      console.warn(`  no org match for "${key}" — skipped`);
      continue;
    }

    const { data: deals } = await db
      .from("deals")
      .select("id, status")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: false });
    const target = (deals ?? []).find((d) => d.status === "open") ?? (deals ?? [])[0];
    if (!target) {
      console.warn(`  org "${org.name}" has no deal — skipped`);
      continue;
    }

    const { error } = await db
      .from("deals")
      .update({ proposal_text: text, proposal_exists: true })
      .eq("id", target.id);
    if (error) throw error;
    affectedOrgs.add(org.id);
    attached++;
    console.log(`  attached "${file}" → ${org.name} (deal ${target.id})`);
  }

  // Re-derive tiers for affected orgs.
  for (const orgId of affectedOrgs) {
    const { data: deals } = await db.from("deals").select("status, proposal_exists").eq("organisation_id", orgId);
    const tier = deriveTier((deals ?? []) as DealTierInput[]);
    await db.from("organisations").update({ tier }).eq("id", orgId);
  }

  console.log(`Attached ${attached} proposals; re-derived ${affectedOrgs.size} org tiers.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
