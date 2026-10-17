"use server";

// Server actions for the Campaigns UI (P5 mailer). Queue from a segment,
// approve, send a batch, or discard a queued campaign. All write through the
// mailer lib so the CLI and UI share one code path.

import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { currentUserId } from "@/lib/auth/owner";
import { queueCampaign, approveCampaign } from "@/lib/mailer/queue";
import { runHsSendBatch } from "@/lib/mailer/send";
import { parseSegment, segmentLabel } from "@/lib/mailer/types";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

export async function queueCampaignAction(formData: FormData) {
  const kind = str(formData.get("segment_kind"));
  const source = str(formData.get("source"));
  const spec = kind === "source" ? `source:${source}` : kind;
  const segment = parseSegment(spec);

  const subject = str(formData.get("subject"));
  const bodyTemplate = str(formData.get("body"));
  if (!subject || !bodyTemplate) return;
  const campaign = str(formData.get("campaign")) || `${segmentLabel(segment)}-${new Date().toISOString().slice(0, 10)}`;
  const cooldown = str(formData.get("cooldown"));
  const cap = str(formData.get("cap"));

  const ownerId = await currentUserId();
  await queueCampaign(serviceClient(), {
    segment, campaign, subject, bodyTemplate,
    cooldownDays: cooldown ? Number(cooldown) : undefined,
    cap: cap ? Number(cap) : undefined,
    ownerId,
  });
  revalidatePath("/campaigns");
}

export async function approveCampaignAction(formData: FormData) {
  const campaign = str(formData.get("campaign"));
  await approveCampaign(serviceClient(), campaign || null);
  revalidatePath("/campaigns");
}

export async function sendBatchAction(formData: FormData) {
  const batch = str(formData.get("batch"));
  await runHsSendBatch(serviceClient(), { batch: batch ? Number(batch) : 50, force: true });
  revalidatePath("/campaigns");
}

/** Discard still-queued rows for a campaign (doesn't touch sent history). */
export async function discardQueuedAction(formData: FormData) {
  const campaign = str(formData.get("campaign"));
  if (!campaign) return;
  await serviceClient().from("hs_sends").delete().eq("campaign", campaign).in("status", ["queued", "approved"]);
  revalidatePath("/campaigns");
}
