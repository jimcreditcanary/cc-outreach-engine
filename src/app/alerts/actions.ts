"use server";

import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { detectPressAlerts } from "@/lib/alerts/detect";
import { enrichCompany } from "@/lib/enrich/company";

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

/** Manual "run the weekly cron now" — useful right after deploying so
 *  you don't have to wait until Sunday 22:00 to see alerts populate.
 *  Same code path as /api/cron/alerts but capped to 25 enrichments to
 *  keep the request inside the server-action timeout. */
export async function runAlertsNowAction() {
  const db = serviceClient();
  const errors: string[] = [];
  let pressInserted = 0;
  let enriched = 0;

  try {
    const r = await detectPressAlerts(db, 14);
    pressInserted = r.inserted;
  } catch (e) {
    errors.push(`press: ${(e as Error).message}`);
  }

  const staleCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: stale } = await db
    .from("organisations")
    .select("id, name")
    .eq("is_partner", false)
    .not("website", "is", null)
    .or(`enriched_at.is.null,enriched_at.lt.${staleCutoff}`)
    .order("enriched_at", { ascending: true, nullsFirst: true })
    .limit(25); // tighter than the cron — fits inside a server-action turn

  for (const o of stale ?? []) {
    try {
      await enrichCompany(db, o.id as string);
      enriched++;
    } catch (e) {
      const msg = (e as Error).message;
      if (!/no website/i.test(msg)) errors.push(`${o.name ?? o.id}: ${msg.slice(0, 80)}`);
    }
  }

  await flash(
    errors.length ? "error" : "success",
    `Alerts refreshed — ${pressInserted} press alert(s), ${enriched} compan${enriched === 1 ? "y" : "ies"} re-enriched${errors.length ? ` · ${errors.length} error(s): ${errors[0]}` : ""}`,
  );
  revalidatePath("/alerts");
}
