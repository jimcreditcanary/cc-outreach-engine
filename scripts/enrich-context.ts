// Curate per-contact Context (recent news/posts, named people, a problem
// statement) via SERP + Claude, and write it to the HubSpot contact's Context
// field for the drafter. Writes by default; --dry previews without writing.
//
//   npm run enrich-context -- stelford@evedigital.co.uk   # one contact
//   npm run enrich-context -- --limit=10                   # 10 newest leads
//   npm run enrich-context -- --limit=10 --dry             # preview only

import { config } from "dotenv";
config({ path: ".env.local", override: true });

const DRY = process.argv.includes("--dry");
const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main() {
  const { hubspotRepo, findContactByEmail } = await import("../src/lib/hubspot/repo");
  const { researchContact, serpEnabled } = await import("../src/lib/mailer/research");
  if (!serpEnabled()) { console.error("✗ No SERP key (SERPER_API_KEY) in .env.local."); process.exit(1); }

  const emailArg = process.argv.slice(2).find((a) => a.includes("@"));
  const limit = Number(flag("limit") ?? 5);

  const targets = emailArg
    ? [await findContactByEmail(emailArg)].filter(Boolean)
    : (await hubspotRepo.listContacts({ newOnly: true, limit, sort: { col: "created_at", dir: "desc" } })).records;

  if (targets.length === 0) { console.error("No target contacts."); process.exit(1); }
  console.log(`${DRY ? "DRY RUN · " : ""}enriching ${targets.length} contact(s)…`);

  for (const c of targets) {
    if (!c) continue;
    const company = c.company_id ? await hubspotRepo.getCompany(c.company_id) : null;
    const res = await researchContact({
      full_name: c.full_name,
      job_title: c.job_title,
      company_name: company?.name ?? c.company_name,
      domain: company?.website ?? company?.domain ?? null,
      industry: company?.industry ?? null,
    });
    const brief = `${res.context_md.trim()}\n\n_Problem: ${res.problem_statement ?? "—"} · confidence: ${res.confidence} · updated ${new Date().toISOString().slice(0, 10)}_`;
    console.log(`\n=== ${c.full_name} @ ${company?.name ?? "—"} — confidence ${res.confidence}, ${res.sources.length} sources ===\n${brief}`);
    if (!DRY) {
      await hubspotRepo.updateContact(c.id, { context: brief });
      console.log("  ↳ written to HubSpot contact Context");
    }
    await new Promise((r) => setTimeout(r, 1500)); // gentle pacing
  }
  console.log(`\n${DRY ? "Dry run complete." : "✓ Done."}`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
