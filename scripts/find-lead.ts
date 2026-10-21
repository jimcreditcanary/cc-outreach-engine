// Search the CRM (HubSpot) for a lead by name, email or company — substring
// (case-insensitive) across contacts and companies, with HubSpot + VeepVeep
// links. Uses CONTAINS_TOKEN wildcards, so a partial surname or company word
// matches (e.g. "barra" finds Barraclough, Barratt…).
//
//   npm run find-lead -- barras
//   npm run find-lead -- "jane@acme.co.uk"
//   npm run find-lead -- "credit union"

import { config } from "dotenv";
config({ path: ".env.local", override: true });

interface HsObj { id: string | number; properties: Record<string, string | null | undefined> }

async function main() {
  const q = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!q) {
    console.error("Usage: npm run find-lead -- <name | email | company>");
    process.exit(1);
  }

  const { hsFetch, recordUrl } = await import("../src/lib/hubspot/client");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  const term = `*${q}*`;

  // Contacts: OR across the fields a lead is likely found by.
  const contactGroups = ["firstname", "lastname", "email", "company"].map((p) => ({
    filters: [{ propertyName: p, operator: "CONTAINS_TOKEN", value: term }],
  }));
  const [cRes, coRes] = await Promise.all([
    hsFetch<{ total: number; results: HsObj[] }>("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: { filterGroups: contactGroups, properties: ["firstname", "lastname", "email", "jobtitle", "company", "hs_lead_status", "lead_source", "hs_email_hard_bounce_reason_enum"], limit: 30 },
    }),
    hsFetch<{ total: number; results: HsObj[] }>("/crm/v3/objects/companies/search", {
      method: "POST",
      body: { filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: term }] }], properties: ["name", "domain", "website", "industry", "current_client", "company_number"], limit: 30 },
    }),
  ]);

  // Dedupe contacts by id (a record can match more than one OR group).
  const seen = new Set<string>();
  const contacts = (cRes.results ?? []).filter((r) => { const id = String(r.id); if (seen.has(id)) return false; seen.add(id); return true; });
  const companies = coRes.results ?? [];

  console.log(`\n🔎 "${q}" — ${contacts.length} contact match(es), ${companies.length} company match(es)\n`);

  if (contacts.length) {
    console.log("CONTACTS");
    for (const r of contacts) {
      const p = r.properties;
      const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "(no name)";
      const flags = `${p.hs_lead_status === "NEW" ? "  [NEW]" : ""}${p.hs_email_hard_bounce_reason_enum ? "  [BOUNCED]" : ""}`;
      console.log(`• ${name}${flags}`);
      console.log(`    ${p.email ?? "—"} · ${p.jobtitle ?? "—"} · ${p.company ?? "—"}`);
      console.log(`    status: ${p.hs_lead_status ?? "—"} · source: ${p.lead_source ?? "—"}`);
      console.log(`    HubSpot:  ${recordUrl("contacts", String(r.id))}`);
      console.log(`    VeepVeep: ${appUrl}/contacts/${r.id}`);
    }
    console.log("");
  }

  if (companies.length) {
    console.log("COMPANIES");
    for (const r of companies) {
      const p = r.properties;
      console.log(`• ${p.name || "(no name)"}${p.current_client === "true" ? "  [CLIENT]" : ""}`);
      console.log(`    ${p.website ?? p.domain ?? "—"} · ${p.industry ?? "—"}${p.company_number ? ` · Co.no ${p.company_number}` : ""}`);
      console.log(`    HubSpot:  ${recordUrl("companies", String(r.id))}`);
      console.log(`    VeepVeep: ${appUrl}/companies/${r.id}`);
    }
    console.log("");
  }

  if (!contacts.length && !companies.length) {
    console.log("No matches. Try fewer letters (a partial surname/company word), an email address, or a different spelling.");
  }
}

main().catch((e) => {
  console.error("✗", (e as Error)?.message ?? e);
  process.exit(1);
});
