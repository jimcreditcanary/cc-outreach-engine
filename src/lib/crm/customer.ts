// The dedicated "customer" flag per HubSpot company (migration 064). Marks a
// company a customer for the Customers tab — local-only, never written to
// HubSpot. All access via the service-role client.

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export async function isCustomer(db: DB, companyId: string): Promise<boolean> {
  const { data } = await db.from("crm_customer_flags").select("is_customer").eq("hubspot_company_id", companyId).maybeSingle();
  return data?.is_customer === true;
}

export async function setCustomer(db: DB, companyId: string, on: boolean, userId: string | null): Promise<void> {
  const { error } = await db.from("crm_customer_flags").upsert(
    { hubspot_company_id: companyId, is_customer: on, marked_by: userId, updated_at: new Date().toISOString() },
    { onConflict: "hubspot_company_id" },
  );
  if (error) throw error;
}

/** HubSpot company ids currently flagged as customers. */
export async function listCustomerCompanyIds(db: DB): Promise<string[]> {
  const { data } = await db.from("crm_customer_flags").select("hubspot_company_id").eq("is_customer", true);
  return (data ?? []).map((r) => (r as { hubspot_company_id: string }).hubspot_company_id);
}
