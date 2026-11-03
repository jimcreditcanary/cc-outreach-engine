"use server";

// Server actions for the HubSpot-backed contact detail page (P3b). Each writes
// through getCrm().updateContact and revalidates. Kept separate from the
// Supabase actions in ../actions.ts so the two backends don't tangle.

import { revalidatePath } from "next/cache";
import { getCrm } from "@/lib/crm";
import { bulkUpdateContacts } from "@/lib/hubspot/repo";
import type { ContactWrite } from "@/lib/crm/types";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

/** Edit core identity fields. Name/email are only changed when non-empty (never
 *  cleared); job title and mobile can be cleared. */
export async function updateHubspotContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const patch: ContactWrite = {
    job_title: s(formData.get("job_title")),
    mobile: s(formData.get("mobile")),
  };
  // First/last are separate fields now. They're always present in the form, so
  // send them (first name required; last name may be cleared).
  const first = s(formData.get("first_name"));
  if (first) patch.first_name = first;
  patch.last_name = s(formData.get("last_name"));
  const email = s(formData.get("email"));
  if (email) patch.email = email;
  // Only touch `type` when the editor was rendered (property exists), so we
  // never PATCH a non-existent property. Empty selection clears the roles.
  if (formData.get("contact_type_present")) patch.contact_type = formData.getAll("contact_type").map(String).filter(Boolean);
  await getCrm().updateContact(id, patch);
  revalidatePath(`/contacts/${id}`);
}

/** Bulk-edit selected contacts (owner reassignment and/or mark actioned). No delete. */
export async function bulkUpdateContactsAction(formData: FormData) {
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (!ids.length) return;
  const patch: ContactWrite = {};
  const owner = String(formData.get("owner_id") ?? "");
  if (owner === "__unassign__") patch.owner_id = null;
  else if (owner) patch.owner_id = owner;
  if (formData.get("mark_actioned")) patch.is_new = false;
  if (Object.keys(patch).length === 0) return;
  await bulkUpdateContacts(ids, patch);
  revalidatePath("/contacts");
}

/** Clear the New flag (hs_lead_status NEW → IN_PROGRESS). */
export async function markHubspotActioned(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await getCrm().updateContact(id, { is_new: false });
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
}

/** Confirm a guessed email (email_status Extrapolated → Verified), making it
 *  eligible for outreach. */
export async function confirmHubspotEmail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await getCrm().updateContact(id, { email_guessed: false });
  revalidatePath(`/contacts/${id}`);
}
