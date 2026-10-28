// Read failover: wrap the live HubSpot repo so that when HubSpot is unreachable
// the app transparently serves reads from the Supabase mirror instead of
// erroring. Only genuine outages fail over (network error, broken token,
// throttle-after-retries, 5xx) — ordinary 4xx logic errors (and 404→null) are
// surfaced unchanged so real bugs aren't masked. Writes never fall back: they
// can't reach HubSpot during an outage, so they error (as they should).

import { HubSpotError } from "../hubspot/client";
import type { CrmRepository } from "./types";

function isOutage(err: unknown): boolean {
  if (err instanceof HubSpotError) {
    // 0 = not configured / thrown before fetch; 401/403 = broken token;
    // 408/429 = timeout/throttle surviving retries; 5xx = HubSpot down.
    return err.status === 0 || err.status === 401 || err.status === 403 || err.status === 408 || err.status === 429 || err.status >= 500;
  }
  // Not a HubSpotError ⇒ a raw fetch rejection (DNS, TLS, timeout, refused).
  return true;
}

async function readThrough<T>(label: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    if (!isOutage(err)) throw err;
    console.warn(`[crm failover] HubSpot read "${label}" failed (${(err as Error)?.message}) — serving from Supabase mirror.`);
    try {
      return await fallback();
    } catch (fallbackErr) {
      console.error(`[crm failover] mirror fallback for "${label}" also failed:`, (fallbackErr as Error)?.message);
      throw err; // surface the original HubSpot error, not the mirror's
    }
  }
}

/** Reads try `primary`, falling back to `fallback` on an outage; writes use
 *  `primary` only. */
export function withFailover(primary: CrmRepository, fallback: CrmRepository): CrmRepository {
  return {
    listContacts: (o) => readThrough("listContacts", () => primary.listContacts(o), () => fallback.listContacts(o)),
    getContact: (id) => readThrough("getContact", () => primary.getContact(id), () => fallback.getContact(id)),
    listCompanies: (o) => readThrough("listCompanies", () => primary.listCompanies(o), () => fallback.listCompanies(o)),
    getCompany: (id) => readThrough("getCompany", () => primary.getCompany(id), () => fallback.getCompany(id)),
    listCompanyContacts: (id, limit) => readThrough("listCompanyContacts", () => primary.listCompanyContacts(id, limit), () => fallback.listCompanyContacts(id, limit)),
    listDeals: (o) => readThrough("listDeals", () => primary.listDeals(o), () => fallback.listDeals(o)),

    createContact: (i) => primary.createContact(i),
    updateContact: (id, p) => primary.updateContact(id, p),
    updateCompany: (id, p) => primary.updateCompany(id, p),
  };
}
