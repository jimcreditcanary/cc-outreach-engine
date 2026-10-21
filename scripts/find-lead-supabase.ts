// Search the legacy Supabase CRM for a lead by name, email or company — the
// counterpart to find-lead (which searches HubSpot). Useful for contacts
// captured before the HubSpot cutover (they live in Supabase, not HubSpot).
//
//   npm run find-lead-supabase -- barras
//   npm run find-lead-supabase -- "just credit union"
//   npm run find-lead-supabase -- jane@acme.co.uk

import { config } from "dotenv";
config({ path: ".env.local", override: true });

type Org = { id: string; name: string | null };
type Contact = {
  id: string; full_name: string | null; email: string | null; job_title: string | null;
  mobile: string | null; status: string | null; lead_source: string | null; created_at: string | null;
  organisation: Org | Org[] | null;
};
const orgOf = (c: Contact): Org | null => (Array.isArray(c.organisation) ? c.organisation[0] ?? null : c.organisation);

async function main() {
  const q = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!q) { console.error("Usage: npm run find-lead-supabase -- <name | email | company>"); process.exit(1); }

  const { serviceClient } = await import("../src/lib/db/client");
  const db = serviceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  const like = `%${q}%`;
  const sel = "id, full_name, email, job_title, mobile, status, lead_source, created_at, organisation:organisations(id, name)";

  // Contacts by name or email; organisations by name; contacts at those orgs.
  const [byName, byEmail, orgRes] = await Promise.all([
    db.from("contacts").select(sel).ilike("full_name", like).limit(50),
    db.from("contacts").select(sel).ilike("email", like).limit(50),
    db.from("organisations").select("id, name, website, industry").ilike("name", like).limit(50),
  ]);
  const orgs = (orgRes.data ?? []) as { id: string; name: string | null; website: string | null; industry: string | null }[];
  let byOrg: { data: Contact[] | null } = { data: [] };
  if (orgs.length) byOrg = await db.from("contacts").select(sel).in("organisation_id", orgs.map((o) => o.id)).limit(100) as { data: Contact[] | null };

  // Merge + dedupe contacts by id.
  const map = new Map<string, Contact>();
  for (const list of [byName.data, byEmail.data, byOrg.data]) for (const c of (list ?? []) as Contact[]) map.set(c.id, c);
  const contacts = [...map.values()];

  console.log(`\n🔎 Supabase · "${q}" — ${contacts.length} contact match(es), ${orgs.length} company match(es)\n`);

  if (contacts.length) {
    console.log("CONTACTS");
    for (const c of contacts) {
      const org = orgOf(c);
      console.log(`• ${c.full_name || "(no name)"}${c.status === "new" ? "  [NEW]" : ""}`);
      console.log(`    ${c.email ?? "—"} · ${c.job_title ?? "—"} · ${org?.name ?? "—"}`);
      console.log(`    source: ${c.lead_source ?? "—"} · added ${c.created_at ? c.created_at.slice(0, 10) : "—"}`);
      console.log(`    VeepVeep: ${appUrl}/contacts/${c.id}`);
    }
    console.log("");
  }

  if (orgs.length) {
    console.log("COMPANIES");
    for (const o of orgs) {
      console.log(`• ${o.name || "(no name)"}`);
      console.log(`    ${o.website ?? "—"} · ${o.industry ?? "—"}`);
      console.log(`    VeepVeep: ${appUrl}/companies/${o.id}`);
    }
    console.log("");
  }

  if (!contacts.length && !orgs.length) {
    console.log("No matches in Supabase. Try a partial name/company, an email, or check HubSpot: npm run find-lead -- " + q);
  }
}

main().catch((e) => { console.error("✗", (e as Error)?.message ?? e); process.exit(1); });
