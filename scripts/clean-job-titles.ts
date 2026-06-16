// Re-clean the job titles set by enrich-job-titles.ts: salvage a real title
// from messy SERP headlines ("CEO. Advantage Finance" → "CEO"), and clear
// the ones that aren't titles at all (taglines, sentences, locations).
//
//   npx tsx scripts/clean-job-titles.ts            # dry run (shows before→after)
//   npx tsx scripts/clean-job-titles.ts --apply
//
// Only touches contacts whose title came from the SERP enrichment run (via
// its timeline events), so hand-entered titles are never altered.

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";
import { cleanStoredTitle } from "../src/lib/contacts/serpJobTitle";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Contacts whose title came from the enrichment run.
  const { data: ev } = await db
    .from("events")
    .select("contact_id")
    .eq("source", "enrich-job-titles")
    .like("payload->>message", "Job title from%")
    .limit(5000);
  const ids = [...new Set((ev ?? []).map((e) => e.contact_id as string))];

  const rows: { id: string; full_name: string | null; job_title: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("contacts").select("id, full_name, job_title").in("id", ids.slice(i, i + 200));
    rows.push(...((data ?? []) as typeof rows));
  }

  let changed = 0, cleared = 0, untouched = 0;
  for (const r of rows) {
    const cleaned = cleanStoredTitle(r.job_title);
    if (cleaned === r.job_title) { untouched++; continue; }
    if (cleaned === null) {
      cleared++;
      console.log(`CLEAR   ${r.full_name}: "${r.job_title}"`);
      if (APPLY) {
        await db.from("contacts").update({ job_title: null }).eq("id", r.id);
        await db.from("events").insert({ contact_id: r.id, type: "crm_change", payload: { kind: "job_title_enrich", message: `Cleared non-title SERP headline: "${r.job_title}"` }, source: "clean-job-titles" });
      }
    } else {
      changed++;
      console.log(`CLEAN   ${r.full_name}: "${r.job_title}" → "${cleaned}"`);
      if (APPLY) {
        await db.from("contacts").update({ job_title: cleaned }).eq("id", r.id);
        await db.from("events").insert({ contact_id: r.id, type: "crm_change", payload: { kind: "job_title_enrich", message: `Tidied SERP title → ${cleaned}` }, source: "clean-job-titles" });
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "DRY RUN"}: ${rows.length} reviewed · ${changed} tidied · ${cleared} cleared · ${untouched} already clean`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().catch((e) => { console.error(e); process.exit(1); });
