// Resolve HubSpot owner ids → display names/emails for the console UI.
// One cached fetch of the owners list (hsFetch, ~5 min TTL); every lookup is a
// map read. Records carry the raw hubspot_owner_id; the repo enriches owner_name
// off this map so views don't each have to resolve owners themselves.

import { hsFetch } from "./client";

export interface Owner {
  id: string;
  /** "Jane Smith", falling back to email, then the raw id. */
  name: string;
  email: string | null;
}

interface HsOwner {
  id: string | number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

/** All active HubSpot owners, keyed by id. Cached ~5 min via hsFetch; paginates
 *  so portals with >100 owners resolve in full. Best-effort: an empty map on
 *  failure (owner columns just render blank rather than erroring the page). */
export async function listOwners(): Promise<Map<string, Owner>> {
  const map = new Map<string, Owner>();
  try {
    let after: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const res = await hsFetch<{ results: HsOwner[]; paging?: { next?: { after?: string } } }>(
        `/crm/v3/owners?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        { cacheTtl: 300_000 },
      );
      for (const o of res.results ?? []) {
        const id = String(o.id);
        const email = (o.email ?? "").trim();
        const name = [o.firstName, o.lastName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
        map.set(id, { id, name: name || email || id, email: email || null });
      }
      after = res.paging?.next?.after;
      if (!after) break;
    }
  } catch {
    // leave the map as-is (possibly partial) — owner display degrades gracefully
  }
  return map;
}

/** Owner display name for an id, or null. Pass a map from listOwners(). */
export function ownerName(owners: Map<string, Owner>, id: string | null | undefined): string | null {
  if (!id) return null;
  return owners.get(String(id))?.name ?? null;
}

/** As a sorted list for a picker/filter (name-ascending). */
export function ownerOptions(owners: Map<string, Owner>): Owner[] {
  return [...owners.values()].sort((a, b) => a.name.localeCompare(b.name));
}
