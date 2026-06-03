// Owner-of-record helpers for the multi-user CRM. Every CRM entity has an
// owner_id pointing at auth.users; lists default to "my stuff" via these.
//
//   currentUserId()   — the signed-in operator id, or null (cron / unauthed)
//   listOperators()   — every operator in the workspace, for owner pickers
//   resolveOwnerFilter() — turns ?owner=me|all|<uuid> + signed-in user into
//                          either { col, value } or null (no filter)
//   displayName(op)   — "First Last" / "First" / email / id, in that order

import { currentUser } from "./server";
import { adminClient } from "./admin";
import { serviceClient } from "@/lib/db/client";

export interface Operator {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  /** ISO timestamp of their most recent successful sign-in, or null. */
  last_sign_in_at: string | null;
  /** "First Last" if both set, else "First", else the email, else the id.
   *  Pre-computed so pickers don't have to format on every render. */
  display_name: string;
}

export async function currentUserId(): Promise<string | null> {
  const u = await currentUser();
  return u?.id ?? null;
}

/** Format an operator name. Exported so non-listOperators call sites
 *  (e.g. raw auth.users data on /admin/users) can use the same rules. */
export function displayName(
  op: { first_name?: string | null; last_name?: string | null; email?: string | null; id: string },
): string {
  const first = op.first_name?.trim();
  const last = op.last_name?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (op.email) return op.email;
  return op.id;
}

/** Every Supabase auth user, joined with their user_settings profile.
 *  Limit 100 — well beyond the size of any plausible sales team. */
export async function listOperators(): Promise<Operator[]> {
  const [{ data: usersData }, { data: settingsData }] = await Promise.all([
    adminClient().auth.admin.listUsers({ page: 1, perPage: 100 }),
    serviceClient().from("user_settings").select("user_id, first_name, last_name, job_title"),
  ]);
  const settingsById = new Map(
    ((settingsData ?? []) as { user_id: string; first_name: string | null; last_name: string | null; job_title: string | null }[])
      .map((s) => [s.user_id, s]),
  );
  return (usersData?.users ?? []).map((u) => {
    const s = settingsById.get(u.id);
    const op = {
      id: u.id,
      email: u.email ?? null,
      first_name: s?.first_name ?? null,
      last_name:  s?.last_name  ?? null,
      job_title:  s?.job_title  ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    };
    return { ...op, display_name: displayName(op) };
  });
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
