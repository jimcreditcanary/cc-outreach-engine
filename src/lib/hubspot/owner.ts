// Resolve a veepveep operator → their HubSpot owner id. Per-user mapping in
// user_settings.hubspot_owner_id, falling back to the workspace default
// (HUBSPOT_LEAD_OWNER_ID, else Jim). Graceful if migration 044 isn't applied.

import type { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;

export const DEFAULT_HS_OWNER = process.env.HUBSPOT_LEAD_OWNER_ID ?? "86510668";

export async function resolveHubspotOwner(db: DB, userId: string | null | undefined): Promise<string> {
  if (!userId) return DEFAULT_HS_OWNER;
  try {
    const { data } = await db.from("user_settings").select("hubspot_owner_id").eq("user_id", userId).maybeSingle();
    const id = String((data as { hubspot_owner_id?: string | null } | null)?.hubspot_owner_id ?? "").trim();
    return id || DEFAULT_HS_OWNER;
  } catch {
    return DEFAULT_HS_OWNER;
  }
}
