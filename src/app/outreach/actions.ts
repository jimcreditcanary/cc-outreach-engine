"use server";

// Server actions for the Outreach workflow surface: kick off a (small) draft
// run, then review — approve / edit / discard — and send the approved queue.
// Heavy/large runs belong on the CLI or cron; the in-app run is capped so it
// completes within the request budget.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { runDraftWorkflow } from "@/lib/mailer/workflow";
import { runDealNurture } from "@/lib/mailer/nurture";
import { runHsSendBatch } from "@/lib/mailer/send";
import { loadDraftConfig } from "@/lib/mailer/config";
import { resolveHubspotOwner } from "@/lib/hubspot/owner";
import { parseSegment, segmentLabel } from "@/lib/mailer/types";
import { textToHtml } from "@/lib/mailer/render";
import { recordDisposition, monthsFromNow, type Disposition } from "@/lib/outreach/dispositions";
import { setContactLeadStatus } from "@/lib/hubspot/repo";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const UI_RUN_CAP = 6; // keep in-app runs within the request budget

export async function draftRunAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const kind = str(formData.get("segment_kind"));
  const source = str(formData.get("source"));
  let segment;
  try {
    segment = parseSegment(kind === "source" ? `source:${source}` : kind);
  } catch {
    await flash("error", "Pick a valid segment.");
    return redirect("/outreach");
  }
  const limit = Math.min(Math.max(1, Number(str(formData.get("limit")) || 3)), UI_RUN_CAP);
  const campaign = str(formData.get("campaign")) || `${segmentLabel(segment)}-${new Date().toISOString().slice(0, 10)}`;

  const db = serviceClient();
  const config = await loadDraftConfig(db, me.id);
  try {
    const res = await runDraftWorkflow(db, {
      segment, campaign, limit, ownerId: me.id, config,
      autoSendHigh: str(formData.get("auto_send")) === "on",
    });
    await flash("success", `Drafted ${res.processed}: ${res.approved} auto-approved, ${res.queued} to review (skipped ${res.skippedRecent + res.skippedSuppressed}).`);
  } catch (e) {
    await flash("error", `Draft run failed: ${(e as Error).message}`);
  }
  revalidatePath("/outreach");
}

export async function nurtureRunAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const limit = Math.min(Math.max(1, Number(str(formData.get("limit")) || 3)), UI_RUN_CAP);
  const db = serviceClient();
  const config = await loadDraftConfig(db, me.id);
  const ownerHubspotId = await resolveHubspotOwner(db, me.id);
  try {
    const res = await runDealNurture(db, { ownerHubspotId, ownerId: me.id, limit, config });
    await flash("success", `Appraised + drafted ${res.queued} deal nudge(s) to review (skipped ${res.skippedRecent} in-comms, ${res.skippedNoContact} no-contact).`);
  } catch (e) {
    await flash("error", `Deal nurture failed: ${(e as Error).message}`);
  }
  revalidatePath("/outreach");
}

export async function approveDraftAction(formData: FormData) {
  const id = str(formData.get("id"));
  if (id) await serviceClient().from("hs_sends").update({ status: "approved" }).eq("id", id).eq("status", "queued");
  revalidatePath("/outreach");
}

/** Discard a drafted email, recording why + what happens to the contact:
 *  - disqualified → hard do-not-contact (suppressions + HubSpot UNQUALIFIED)
 *  - removed      → out of the automated workflow, still a lead
 *  - snoozed      → skipped until now + N months (HubSpot BAD_TIMING), re-enters after
 *  The draft is always deleted. The disposition drives who the draft workflow
 *  skips next run. Everything past the delete is best-effort. */
export async function discardDraftAction(formData: FormData) {
  const me = await currentUser();
  const db = serviceClient();
  const id = str(formData.get("id"));
  if (!id) { revalidatePath("/outreach"); return; }

  const hsContactId = str(formData.get("hs_contact_id"));
  const email = str(formData.get("email")) || null;
  const reason = str(formData.get("reason")) || null;
  const raw = str(formData.get("disposition"));
  const disposition: Disposition = raw === "disqualified" || raw === "snoozed" ? raw : "removed";
  const months = Math.min(Math.max(1, Number(str(formData.get("months")) || 3)), 24);

  // Always drop the draft from the queue.
  await db.from("hs_sends").delete().eq("id", id).in("status", ["queued", "approved"]);

  if (hsContactId) {
    const snoozeUntil = disposition === "snoozed" ? monthsFromNow(months) : null;
    await recordDisposition(db, { hsContactId, email, disposition, reason, snoozeUntil, userId: me?.id ?? null });

    if (disposition === "disqualified") {
      if (email) {
        // Unique index is on lower(email); a plain insert + swallow handles the
        // "already suppressed" case (no bare-column constraint for upsert).
        await db.from("suppressions")
          .insert({ email, reason: "manual", note: reason ?? "Disqualified from Workflow" })
          .then(undefined, () => {});
      }
      try { await setContactLeadStatus(hsContactId, "UNQUALIFIED"); } catch { /* best-effort */ }
    } else if (disposition === "snoozed") {
      try { await setContactLeadStatus(hsContactId, "BAD_TIMING"); } catch { /* best-effort */ }
    }
  }

  const label = disposition === "disqualified" ? "disqualified" : disposition === "snoozed" ? `snoozed ${months} month${months === 1 ? "" : "s"}` : "removed from workflow";
  await flash("success", `Draft discarded — ${label}.`);
  revalidatePath("/outreach");
}

/** "I'll send it myself" — the operator is sending this from their own inbox, so
 *  mark it done WITHOUT the system sending it. Terminal 'sent' (tagged manual) so
 *  the Postmark batch can never also send it — a double-send. The operator's
 *  connected inbox handles the HubSpot logging / open-tracking. */
export async function markSentManualAction(formData: FormData) {
  const id = str(formData.get("id"));
  if (id) {
    await serviceClient()
      .from("hs_sends")
      .update({ status: "sent", sent_at: new Date().toISOString(), postmark_message_id: "manual" })
      .eq("id", id)
      .in("status", ["queued", "approved"]);
  }
  revalidatePath("/outreach");
}

export async function editDraftAction(formData: FormData) {
  const id = str(formData.get("id"));
  const subject = str(formData.get("subject"));
  const body = str(formData.get("body_text"));
  if (id && subject && body) {
    await serviceClient().from("hs_sends")
      .update({ subject, body_text: body, body_html: textToHtml(body) })
      .eq("id", id).in("status", ["queued", "approved"]);
  }
  revalidatePath("/outreach");
}

export async function sendBatchAction(formData: FormData) {
  const batch = Number(str(formData.get("batch")) || 50);
  const r = await runHsSendBatch(serviceClient(), { batch, force: true });
  await flash(r.ok ? "success" : "error", r.reason ?? `Sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}.`);
  revalidatePath("/outreach");
}
