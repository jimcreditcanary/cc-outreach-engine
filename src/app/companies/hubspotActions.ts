"use server";

// Server actions for the HubSpot-backed company detail page (P3). Writes
// through getCrm().updateCompany. Separate from the Supabase actions so the
// two backends don't tangle.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCrm } from "@/lib/crm";
import { bulkUpdateCompanies } from "@/lib/hubspot/repo";
import type { CompanyWrite } from "@/lib/crm/types";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { setCustomer } from "@/lib/crm/customer";

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

/** Bulk-edit selected companies (owner / target group / tier). No delete.
 *  Only the fields the operator actually set are applied. */
export async function bulkUpdateCompaniesAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (!ids.length) return;
  const patch: CompanyWrite = {};
  const owner = String(formData.get("owner_id") ?? "");
  const target = String(formData.get("target_group") ?? "");
  const tier = String(formData.get("tier") ?? "").trim();
  if (owner === "__unassign__") patch.owner_id = null;
  else if (owner) patch.owner_id = owner;
  if (target) patch.target_group = target;
  if (tier) { const n = Number(tier); if (Number.isFinite(n)) patch.tier = n; }
  if (Object.keys(patch).length === 0) return;
  await bulkUpdateCompanies(ids, patch);
  revalidatePath("/companies");
}

/** Mark / unmark a company as an Active Customer. The local crm_customer_flags
 *  flag is the source of truth for the Customers tab; clicking also writes
 *  through to the HubSpot `current_client` property (button → field, one way).
 *  A company that's current_client=true in HubSpot but never flagged here does
 *  NOT appear as a customer. */
export async function toggleCustomerAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = String(formData.get("company_id") ?? "");
  if (!id) return;
  const on = String(formData.get("on") ?? "") === "true";
  await setCustomer(serviceClient(), id, on, me.id);
  // Keep HubSpot in step (write-through only — we never read it back as truth).
  try { await getCrm().updateCompany(id, { current_client: on }); } catch { /* flag is source of truth; HubSpot sync best-effort */ }
  revalidatePath(`/companies/${id}`);
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
