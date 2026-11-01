"use server";

// Server actions for the HubSpot-backed company detail page (P3). Writes
// through getCrm().updateCompany. Separate from the Supabase actions so the
// two backends don't tangle.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCrm } from "@/lib/crm";
import type { CompanyWrite } from "@/lib/crm/types";
import { serviceClient } from "@/lib/db/client";
import { currentUser } from "@/lib/auth/server";
import { setCustomer } from "@/lib/crm/customer";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

export async function updateHubspotCompany(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tierRaw = s(formData.get("tier"));
  const tierNum = tierRaw != null ? Number(tierRaw) : null;
  const cc = s(formData.get("current_client")); // "true" | "false" | null
  const patch: CompanyWrite = {
    website: s(formData.get("website")),
    tier: tierNum != null && Number.isFinite(tierNum) ? tierNum : null,
    is_partner: formData.get("is_partner") != null,
    icp: formData.get("icp") != null,
    current_client: cc == null ? null : cc === "true",
    onboarding_status: s(formData.get("onboarding_status")),
    target_group: s(formData.get("target_group")),
  };
  const name = s(formData.get("name"));
  if (name) patch.name = name;
  await getCrm().updateCompany(id, patch);
  revalidatePath(`/companies/${id}`);
}

/** Mark / unmark a HubSpot company as a customer (dedicated flag, migration 064). */
export async function toggleCustomerAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = String(formData.get("company_id") ?? "");
  if (!id) return;
  const on = String(formData.get("on") ?? "") === "true";
  await setCustomer(serviceClient(), id, on, me.id);
  revalidatePath(`/companies/${id}`);
}
