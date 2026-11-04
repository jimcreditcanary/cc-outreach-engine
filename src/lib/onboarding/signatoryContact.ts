// On merchant-form submit, make sure the authorised signatory exists as a
// HubSpot contact (feedback item 9): if the signatory the customer entered isn't
// already a contact on the company, create one, associate it to the deal and tag
// it as the authorised signatory. Entirely internal (no email to the customer),
// and fully best-effort — a HubSpot hiccup must never block the submission.

import type { serviceClient } from "../db/client";
import { getCrm } from "../crm";
import { dealCompanyId, associateDealContact, associateDealContactRole, hubspotRepo } from "../hubspot/repo";
import { getAnswers } from "./formAnswers";
import { getCase, addStakeholder, logCaseEvent } from "./cases";
import { parsePersonName } from "./personName";

type DB = ReturnType<typeof serviceClient>;

export async function ensureSignatoryContact(db: DB, caseId: string): Promise<void> {
  const c = await getCase(db, caseId);
  if (!c?.hubspot_deal_id) return;

  const answers = await getAnswers(db, caseId);
  const email = (answers["signatory_email"]?.value ?? "").trim();
  const name = (answers["signatory_name"]?.value ?? "").trim();
  const title = (answers["signatory_title"]?.value ?? "").trim();
  if (!email || !name) return;

  const companyId = await dealCompanyId(c.hubspot_deal_id).catch(() => null);
  // Already a contact on the company? Match by email (case-insensitive).
  const existing = companyId ? await getCrm().listCompanyContacts(companyId, 100).catch(() => []) : [];
  const match = existing.find((ct) => (ct.email ?? "").toLowerCase() === email.toLowerCase());

  let contactId: string;
  if (match) {
    contactId = match.id;
  } else {
    const pn = parsePersonName(name);
    const created = await hubspotRepo.createContact({
      first_name: pn.first, last_name: pn.last, email, job_title: title,
      company_id: companyId ?? undefined,
    });
    contactId = created.id;
    await logCaseEvent(db, caseId, "signatory_contact_created", { email: "merchant" }, { contact_id: contactId, email });
  }

  // Tag as the authorised signatory + mirror the association to the deal.
  await addStakeholder(db, caseId, contactId, "authorised_signatory").catch(() => {});
  await associateDealContact(c.hubspot_deal_id, contactId).catch(() => {});
  await associateDealContactRole(c.hubspot_deal_id, contactId, "Authorised signatory").catch(() => {});
}
