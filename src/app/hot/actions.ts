"use server";

// Server actions for the Hot deal-radar. The "✨ Draft nudge" button runs the
// same deal-nurture engine as the Outreach › Nurture tab, but targeted at one
// deal the operator clicked — appraise it (MEDDICC) + draft a next-step email
// into the review queue. Nothing sends here; drafts are reviewed on /outreach.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { runDealNurture } from "@/lib/mailer/nurture";
import { loadDraftConfig } from "@/lib/mailer/config";
import { resolveHubspotOwner } from "@/lib/hubspot/owner";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

export async function draftDealNudgeAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const dealId = str(formData.get("deal_id"));
  if (!dealId) {
    await flash("error", "No deal given.");
    return redirect("/hot");
  }

  const db = serviceClient();
  const config = await loadDraftConfig(db, me.id);
  const ownerHubspotId = await resolveHubspotOwner(db, me.id);
  try {
    const res = await runDealNurture(db, {
      ownerHubspotId,
      ownerId: me.id,
      dealIds: [dealId],
      limit: 1,
      config,
    });
    if (res.queued > 0) {
      await flash("success", "Drafted a nudge — review and send it under Outreach › Nurture.");
    } else if (res.skippedNoContact > 0) {
      await flash("error", "No contact with a usable email is linked to that deal — add one in HubSpot first.");
    } else if (res.skippedRecent > 0) {
      await flash("success", "That deal already has a draft waiting — review it under Outreach › Nurture.");
    } else {
      await flash("error", "Couldn't draft a nudge for that deal.");
    }
  } catch (e) {
    await flash("error", `Draft failed: ${(e as Error).message}`);
  }
  revalidatePath("/hot");
}
