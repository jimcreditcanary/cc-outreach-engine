"use server";

import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { detectPressAlerts } from "@/lib/alerts/detect";
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

/** Manual refresh — re-scans the press window for org-name matches.
 *  Same logic the daily cron runs; surfaced as a button for impatience. */
export async function refreshAlertsAction() {
  const res = await detectPressAlerts(serviceClient(), 14);
  await flash("success", `Refreshed — ${res.inserted} alert${res.inserted === 1 ? "" : "s"} checked`);
  revalidatePath("/alerts");
}
