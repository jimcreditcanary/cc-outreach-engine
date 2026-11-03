// The dedicated "Active Customer" flag per HubSpot company (migration 064).
// This is the source of truth for the Customers tab: a company appears there
// only when its "Active Customer" button has been clicked here — NOT because
// HubSpot's current_client property happens to be true. Clicking the button
// writes through to current_client (button → field, one direction); the flag
// itself is local. All access via the service-role client.

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

/** HubSpot company ids currently flagged as active customers. */
export async function listCustomerCompanyIds(db: DB): Promise<string[]> {
  const { data } = await db.from("crm_customer_flags").select("hubspot_company_id").eq("is_customer", true);
  return (data ?? []).map((r) => (r as { hubspot_company_id: string }).hubspot_company_id);
}
