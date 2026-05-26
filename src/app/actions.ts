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
