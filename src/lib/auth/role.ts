// Operator role helpers. Roles live on user_settings.role (migration 058);
// 'super_admin' is the elevated value that gates /admin/pricing and billing
// overrides. Everyone else is 'operator'.

import { currentUser } from "./server";
import { serviceClient } from "@/lib/db/client";

export type Role = "operator" | "super_admin";

/** The signed-in operator's role, or null if not signed in. Defaults to
 *  'operator' when the user has no user_settings row / null role. */
export async function currentRole(): Promise<Role | null> {
  const me = await currentUser();
  if (!me) return null;
  const { data } = await serviceClient()
    .from("user_settings")
    .select("role")
    .eq("user_id", me.id)
    .maybeSingle();
  return (data?.role as Role | undefined) === "super_admin" ? "super_admin" : "operator";
}

export async function isSuperAdmin(): Promise<boolean> {
  return (await currentRole()) === "super_admin";
}

/** True when the signed-in user may edit pricing / set overrides. Pure-ish
 *  wrapper so server actions and pages share one check (and it's unit-testable
 *  via the role string). */
export function roleCanEditPricing(role: Role | null | undefined): boolean {
  return role === "super_admin";
}
