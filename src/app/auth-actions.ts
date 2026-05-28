"use server";

// Login / logout / invite-user actions. Kept separate from CRM actions so the
// auth surface is easy to audit.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authClient, currentUser } from "@/lib/auth/server";
import { adminClient } from "@/lib/auth/admin";

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
  revalidatePath("/admin/users");
}
