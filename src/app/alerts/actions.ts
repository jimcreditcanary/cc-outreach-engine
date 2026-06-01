"use server";

import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";

export async function dismissAlertAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  await serviceClient().from("alerts").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
  await flash("success", "Alert dismissed");
  revalidatePath("/alerts");
}

export async function undismissAlertAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  await serviceClient().from("alerts").update({ dismissed_at: null }).eq("id", id);
  await flash("success", "Alert restored");
  revalidatePath("/alerts");
}
