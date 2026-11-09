"use server";

// Server action behind the dashboards Refresh button: pulls deals fresh from
// HubSpot into the local mirror (deals only — that's all the dashboards use,
// and it's far quicker than a full-base sync), then revalidates the page so the
// next read sees the new data. Upsert-only; it never deletes.

import { serviceClient } from "@/lib/db/client";
import { runHubspotMirror } from "@/lib/mirror/hubspot";
import { currentUser } from "@/lib/auth/server";
import { revalidatePath } from "next/cache";

export async function resyncDealsAction(): Promise<{ ok: boolean; error?: string }> {
  const me = await currentUser();
  if (!me) return { ok: false, error: "unauthorized" };
  try {
    const res = await runHubspotMirror(serviceClient(), { only: ["deals"] });
    revalidatePath("/dashboards");
    return res.ok ? { ok: true } : { ok: false, error: res.objects.find((o) => !o.ok)?.error ?? "sync incomplete" };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? "sync failed" };
  }
}
