// Operational status (onboarding + billing) for a set of HubSpot company ids,
// read from the local tables. Used wherever a company is shown with its lifecycle
// state — the contact associations panel, the /hot deal workspace, etc.

import { serviceClient } from "@/lib/db/client";

export interface CompanyOps {
  /** Latest non-cancelled onboarding case status, or null. */
  onboarding: string | null;
  onboardingCaseId: string | null;
  /** Billing account status, or null. */
  billing: string | null;
  billingAccountId: string | null;
}

const EMPTY: CompanyOps = { onboarding: null, onboardingCaseId: null, billing: null, billingAccountId: null };

/** Map of hubspot_company_id → onboarding/billing status. Missing ids map to an
 *  all-null CompanyOps so callers can `.get(id)!` safely. */
export async function companyOpsStatus(companyIds: string[]): Promise<Map<string, CompanyOps>> {
  const out = new Map<string, CompanyOps>();
  for (const id of companyIds) out.set(id, { ...EMPTY });
  if (!companyIds.length) return out;

  const db = serviceClient();
  const [{ data: cases }, { data: accts }] = await Promise.all([
    db.from("onboarding_cases").select("id, hubspot_company_id, status, updated_at").in("hubspot_company_id", companyIds).neq("status", "cancelled").order("updated_at", { ascending: true }),
    db.from("billing_accounts").select("id, hubspot_company_id, status").in("hubspot_company_id", companyIds).order("created_at", { ascending: true }),
  ]);
  // Ascending order → the last write wins, i.e. the most recent case/account.
  for (const c of (cases ?? []) as { id: string; hubspot_company_id: string | null; status: string }[]) {
    const o = c.hubspot_company_id ? out.get(c.hubspot_company_id) : null;
    if (o) { o.onboarding = c.status; o.onboardingCaseId = c.id; }
  }
  for (const a of (accts ?? []) as { id: string; hubspot_company_id: string | null; status: string }[]) {
    const o = a.hubspot_company_id ? out.get(a.hubspot_company_id) : null;
    if (o) { o.billing = a.status; o.billingAccountId = a.id; }
  }
  return out;
}
