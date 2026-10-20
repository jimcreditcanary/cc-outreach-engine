"use server";

// Server actions for the HubSpot-backed contact detail page (P3b). Each writes
// through getCrm().updateContact and revalidates. Kept separate from the
// Supabase actions in ../actions.ts so the two backends don't tangle.

import { revalidatePath } from "next/cache";
import { getCrm } from "@/lib/crm";
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
  const fullName = s(formData.get("full_name"));
  const email = s(formData.get("email"));
  if (fullName) patch.full_name = fullName;
  if (email) patch.email = email;
  // Only touch `type` when the editor was rendered (property exists), so we
  // never PATCH a non-existent property. Empty selection clears the roles.
  if (formData.get("contact_type_present")) patch.contact_type = formData.getAll("contact_type").map(String).filter(Boolean);
  await getCrm().updateContact(id, patch);
  revalidatePath(`/contacts/${id}`);
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
