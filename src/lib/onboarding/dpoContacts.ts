// On submit, make sure each data-protection officer the customer entered exists
// as a HubSpot contact (feedback item 6f): for every DPO with a name + email
// that isn't already a contact on the company, create one, associate it to the
// deal and tag it. Entirely internal (no email to the customer), and fully
// best-effort — a HubSpot hiccup must never block the submission. Mirrors
// signatoryContact.ts.

import type { serviceClient } from "../db/client";
import { getCrm } from "../crm";
import { dealCompanyId, associateDealContact, associateDealContactRole, hubspotRepo } from "../hubspot/repo";
import { getAnswers } from "./formAnswers";
import { getCase, addStakeholder, logCaseEvent } from "./cases";

type DB = ReturnType<typeof serviceClient>;

interface Dpo { first: string; last: string; title: string; email: string; phone: string }

/** Collect the structured DPOs from the flat answer keys (dpo_{i}_{field}). */
function collectDpos(answers: Awaited<ReturnType<typeof getAnswers>>): Dpo[] {
  const out: Dpo[] = [];
  for (let i = 0; i < 20; i++) {
    const g = (k: string) => (answers[`dpo_${i}_${k}`]?.value ?? "").trim();
    const rec: Dpo = { first: g("first"), last: g("last"), title: g("title"), email: g("email"), phone: g("phone") };
    if (rec.email && (rec.first || rec.last)) out.push(rec);
  }
  return out;
}

export async function ensureDpoContacts(db: DB, caseId: string): Promise<void> {
  const c = await getCase(db, caseId);
  if (!c?.hubspot_deal_id) return;

  const dpos = collectDpos(await getAnswers(db, caseId));
  if (dpos.length === 0) return;

  const companyId = await dealCompanyId(c.hubspot_deal_id).catch(() => null);
  const existing = companyId ? await getCrm().listCompanyContacts(companyId, 100).catch(() => []) : [];
  const byEmail = new Map(existing.map((ct) => [(ct.email ?? "").toLowerCase(), ct]));

  for (const d of dpos) {
    const match = byEmail.get(d.email.toLowerCase());
    let contactId: string;
    if (match) {
      contactId = match.id;
    } else {
      const created = await hubspotRepo.createContact({
        first_name: d.first, last_name: d.last, email: d.email, job_title: d.title,
        mobile: d.phone || undefined, company_id: companyId ?? undefined,
      }).catch(() => null);
      if (!created) continue;
      contactId = created.id;
      await logCaseEvent(db, caseId, "dpo_contact_created", { email: "merchant" }, { contact_id: contactId, email: d.email });
    }
    // Tag as compliance (closest role) + mirror the deal association.
    await addStakeholder(db, caseId, contactId, "compliance").catch(() => {});
    await associateDealContact(c.hubspot_deal_id, contactId).catch(() => {});
    await associateDealContactRole(c.hubspot_deal_id, contactId, "Data protection officer").catch(() => {});
  }
}
