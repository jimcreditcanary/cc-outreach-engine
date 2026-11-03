"use server";

// Server actions for the HubSpot-backed company detail page (P3). Writes
// through getCrm().updateCompany. Separate from the Supabase actions so the
// two backends don't tangle.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCrm } from "@/lib/crm";
import type { CompanyWrite } from "@/lib/crm/types";
import { currentUser } from "@/lib/auth/server";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

export async function updateHubspotCompany(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Not edited here: current_client (owned by the "Mark as Customer" button),
  // onboarding_status (derived from the onboarding case), and tier (hidden).
  // Omitting them from the patch leaves the HubSpot values untouched.
  const patch: CompanyWrite = {
    website: s(formData.get("website")),
    is_partner: formData.get("is_partner") != null,
    icp: formData.get("icp") != null,
    target_group: s(formData.get("target_group")),
    owner_id: s(formData.get("owner_id")),
  };
  const name = s(formData.get("name"));
  if (name) patch.name = name;
  await getCrm().updateCompany(id, patch);
  revalidatePath(`/companies/${id}`);
}

/** Mark / unmark a HubSpot company as a customer. Single source of truth is the
 *  HubSpot `current_client` property — no separate local flag, no dropdown. */
export async function toggleCustomerAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = String(formData.get("company_id") ?? "");
  if (!id) return;
  const on = String(formData.get("on") ?? "") === "true";
  await getCrm().updateCompany(id, { current_client: on });
  revalidatePath(`/companies/${id}`);
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
