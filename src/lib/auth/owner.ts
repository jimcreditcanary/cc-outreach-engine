// Owner-of-record helpers for the multi-user CRM. Every CRM entity has an
// owner_id pointing at auth.users; lists default to "my stuff" via these.
//
//   currentUserId()   — the signed-in operator id, or null (cron / unauthed)
//   listOperators()   — every operator in the workspace, for owner pickers
//   resolveOwnerFilter() — turns ?owner=me|all|<uuid> + signed-in user into
//                          either { col, value } or null (no filter)

import { currentUser } from "./server";
import { adminClient } from "./admin";

export interface Operator {
  id: string;
  email: string | null;
}

export async function currentUserId(): Promise<string | null> {
  const u = await currentUser();
  return u?.id ?? null;
}

/** Every Supabase auth user, used to populate owner dropdowns. Cached
 *  per-request implicitly via Next's fetch dedupe + the admin client.
 *  Limit 100 — well beyond the size of any plausible sales team. */
export async function listOperators(): Promise<Operator[]> {
  const { data } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 100 });
  return (data?.users ?? []).map((u) => ({ id: u.id, email: u.email ?? null }));
}

/** Normalises the ?owner search param to a concrete user id (or null = no
 *  filter). "me" → the signed-in user; "all" / undefined-when-default-is-all
 *  → null. A raw uuid passes through (used for "show user X's stuff"). */
export async function resolveOwnerFilter(
  raw: string | undefined,
  defaultToMe = true,
): Promise<string | null> {
  if (raw === "all") return null;
  if (raw === "me" || (!raw && defaultToMe)) return await currentUserId();
  if (raw && raw.length >= 32) return raw; // assume uuid
  return null;
}
