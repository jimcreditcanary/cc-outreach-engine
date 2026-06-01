"use server";

// Login / logout / invite-user actions. Kept separate from CRM actions so the
// auth surface is easy to audit.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authClient, currentUser } from "@/lib/auth/server";
import { adminClient } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";

const str = (v: FormDataEntryValue | null): string =>
  String(v ?? "").trim();

export async function loginAction(formData: FormData) {
  const email = str(formData.get("email"));
  const password = str(formData.get("password"));
  if (!email || !password) redirect("/login?error=missing");

  const supa = await authClient();
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/queue");
}

export async function logoutAction() {
  const supa = await authClient();
  await supa.auth.signOut();
  redirect("/login");
}

/** Create a new operator user (instant access — no email confirmation). */
export async function createUserAction(formData: FormData) {
  // Any logged-in user can invite for now — small trusted team.
  const me = await currentUser();
  if (!me) redirect("/login");

  const email = str(formData.get("email"));
  const password = str(formData.get("password"));
  if (!email || !password) return;

  const admin = adminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the confirmation email; instant access
  });
  if (error) throw error;
  await flash("success", `User created: ${email}`);
  revalidatePath("/admin/users");
}

export async function resetPasswordAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("id"));
  const password = str(formData.get("password"));
  if (!id || password.length < 8) return;
  const admin = adminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) throw error;
  await flash("success", "Password reset");
  revalidatePath("/admin/users");
}

export async function deleteUserAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("id"));
  if (!id || id === me.id) return; // no deleting yourself
  const admin = adminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw error;
  await flash("success", "User removed — their owned rows are now unassigned (use Reassign to move them).");
  revalidatePath("/admin/users");
}

/** Bulk re-assign every owned row from one operator to another. Useful
 *  before deleting a user (set NULL on delete would leave everything
 *  orphaned). Hits every entity with an owner_id column. */
export async function reassignOwnershipAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const source = str(formData.get("source_id"));
  const target = str(formData.get("target_id"));
  if (!source || !target || source === target) return;
  const db = serviceClient();
  const tables = ["organisations", "contacts", "deals", "sends", "meetings", "notes"] as const;
  let total = 0;
  for (const t of tables) {
    const { count, error } = await db
      .from(t)
      .update({ owner_id: target }, { count: "exact" })
      .eq("owner_id", source);
    if (error) throw error;
    total += count ?? 0;
  }
  await flash("success", `Re-assigned ${total} row${total === 1 ? "" : "s"}`);
  revalidatePath("/admin/users");
}
