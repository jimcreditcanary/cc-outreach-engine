"use server";

// Server actions for the HubSpot-backed company detail page (P3). Writes
// through getCrm().updateCompany. Separate from the Supabase actions so the
// two backends don't tangle.

import { revalidatePath } from "next/cache";
import { getCrm } from "@/lib/crm";
import type { CompanyWrite } from "@/lib/crm/types";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

export async function updateHubspotCompany(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tierRaw = s(formData.get("tier"));
  const tierNum = tierRaw != null ? Number(tierRaw) : null;
  const patch: CompanyWrite = {
    website: s(formData.get("website")),
    industry: s(formData.get("industry")),
    tier: tierNum != null && Number.isFinite(tierNum) ? tierNum : null,
    is_partner: formData.get("is_partner") != null,
    icp: formData.get("icp") != null,
  };
  const name = s(formData.get("name"));
  if (name) patch.name = name;
  await getCrm().updateCompany(id, patch);
  revalidatePath(`/companies/${id}`);
}
