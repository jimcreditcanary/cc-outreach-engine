"use server";

import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";

export async function approveDraft(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  await db.from("sends").update({ status: "approved" }).eq("id", id).eq("status", "queued");
  revalidatePath("/queue");
}

export async function rejectDraft(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  // A rejected draft is discarded; regenerate later if wanted.
  await db.from("sends").delete().eq("id", id).eq("status", "queued");
  revalidatePath("/queue");
}

/** Record a LinkedIn outreach hook and mark the contact connected. */
export async function saveLinkedInHook(formData: FormData) {
  const contactId = String(formData.get("contact_id"));
  const orgId = (formData.get("organisation_id") as string) || null;
  const hook = String(formData.get("hook") ?? "").trim();
  if (!contactId) return;
  const db = serviceClient();
  await db.from("events").insert({
    contact_id: contactId,
    organisation_id: orgId,
    type: "linkedin_note",
    source: "surface",
    payload: { hook },
  });
  await db.from("contacts").update({ linkedin_connected: true }).eq("id", contactId);
  revalidatePath("/linkedin");
}
