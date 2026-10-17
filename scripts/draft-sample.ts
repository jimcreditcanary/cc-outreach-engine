// Generate ONE sample outreach draft against a real HubSpot contact, to tune
// the drafter's tone before wiring it into the pipeline. Read-only (prints
// only — queues/sends nothing).
//
//   npm run draft-sample                 # auto-pick a finance-sector contact
//   npm run draft-sample -- jane@x.co.uk # a specific contact by email

import { config } from "dotenv";
import type { ContactRecord, CompanyRecord } from "../src/lib/crm/types";
config({ path: ".env.local", override: true });

const FINANCE = /bank|financ|credit|lend|building society|mortgage|insur|fintech|payment/i;

async function main() {
  const { hubspotRepo, findContactByEmail } = await import("../src/lib/hubspot/repo");
  const { draftEmail } = await import("../src/lib/mailer/draft");

  const emailArg = process.argv.slice(2).find((a) => a.includes("@"));

  let contact: ContactRecord | null = emailArg ? await findContactByEmail(emailArg) : null;
  let company: CompanyRecord | null = contact?.company_id ? await hubspotRepo.getCompany(contact.company_id) : null;

  if (!contact) {
    // Auto-pick: scan recent contacts for one at a finance-sector company.
    const page = await hubspotRepo.listContacts({ limit: 40, sort: { col: "created_at", dir: "desc" } });
    let fallback: ContactRecord | null = null;
    for (const c of page.records) {
      if (!c.company_id || !c.email) continue;
      fallback ??= c;
      const co = await hubspotRepo.getCompany(c.company_id);
      if (co && FINANCE.test(`${co.industry ?? ""} ${co.name ?? ""}`)) { contact = c; company = co; break; }
    }
    contact ??= fallback;
    if (contact?.company_id && !company) company = await hubspotRepo.getCompany(contact.company_id);
  }

  if (!contact) { console.error("No suitable contact found."); process.exit(1); }

  console.log(`\nProspect: ${contact.full_name} — ${contact.job_title ?? "—"} @ ${company?.name ?? contact.company_name ?? "—"}`);
  console.log(`Industry: ${company?.industry ?? "—"} | Context: ${company?.context ? company.context.slice(0, 80) + "…" : "(none yet)"}`);
  console.log("Drafting…\n");

  const draft = await draftEmail({
    first_name: contact.full_name?.split(/\s+/)[0] ?? null,
    full_name: contact.full_name,
    job_title: contact.job_title,
    company_name: company?.name ?? contact.company_name,
    industry: company?.industry ?? null,
    company_context: company?.context ?? null,
  });

  console.log("─".repeat(70));
  console.log(`SUBJECT: ${draft.subject}\n`);
  console.log(draft.body);
  console.log("─".repeat(70));
  console.log(`↳ links: ${draft.page_title} — ${draft.page_url}`);
  console.log(`↳ angle: ${draft.angle}`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
