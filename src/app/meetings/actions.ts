"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { syncCalendar } from "@/lib/meetings/sync";
import { generateMeetingBrief } from "@/lib/meetings/brief";
import { generatePostMeetingSummary } from "@/lib/meetings/postSummary";
import { flash } from "@/lib/flash";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function syncCalendarAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const res = await syncCalendar(serviceClient(), me.id);
  if (!res.ok && res.reason?.includes("not connected")) {
    redirect("/api/auth/microsoft/start");
  }
  await flash("success", `Calendar synced — ${res.upserted ?? 0} event${res.upserted === 1 ? "" : "s"} (${res.linked_to_contact ?? 0} linked to contacts)`);
  revalidatePath("/meetings");
}

export async function generateBriefAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  await generateMeetingBrief(serviceClient(), id);
  await flash("success", "Brief generated");
  revalidatePath(`/meetings/${id}`);
}

/** Save a pasted transcript (and any notes) without running the AI. */
export async function saveTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = str(formData.get("transcript"));
  if (!id) return;
  await serviceClient()
    .from("meetings")
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq("id", id);
  await flash("success", "Transcript saved");
  revalidatePath(`/meetings/${id}`);
}

/** AI post-meeting summary from the pasted transcript. If the meeting is
 *  linked to a deal, the summary is also stored as a note + MEDDICC re-seeds. */
export async function generatePostSummaryAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = str(formData.get("transcript"));
  if (!id) return;
  const db = serviceClient();
  // Persist whatever's in the textarea first so the AI sees the latest paste.
  if (transcript !== null) {
    await db.from("meetings").update({ transcript, updated_at: new Date().toISOString() }).eq("id", id);
  }
  const res = await generatePostMeetingSummary(db, id);
  if (!res) {
    await flash("error", "Add a transcript or notes first, then summarise.");
  } else if (res.meddicc_re_seeded) {
    await flash("success", `Summary generated · MEDDICC re-seeded${res.meddicc_biggest_gap ? ` (gap: ${res.meddicc_biggest_gap})` : ""}`);
  } else {
    await flash("success", "Summary generated");
  }
  revalidatePath(`/meetings/${id}`);
}

export async function setSalesRelevantAction(formData: FormData) {
  const id = String(formData.get("id"));
  const relevant = formData.get("relevant") === "true";
  if (!id) return;
  await serviceClient().from("meetings").update({ sales_relevant: relevant }).eq("id", id);
  await flash("success", relevant ? "Marked sales-relevant" : "Hidden as non-sales");
  revalidatePath("/meetings");
  revalidatePath(`/meetings/${id}`);
}

export async function updateMeetingAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  const db = serviceClient();
  await db
    .from("meetings")
    .update({
      organisation_id: str(formData.get("organisation_id")),
      primary_contact_id: str(formData.get("primary_contact_id")),
      deal_id: str(formData.get("deal_id")),
      notes: str(formData.get("notes")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  await flash("success", "Meeting saved");
  revalidatePath(`/meetings/${id}`);
}

export async function deleteMeetingAction(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("meetings").delete().eq("id", id);
  await flash("success", "Meeting deleted");
  revalidatePath("/meetings");
  redirect("/meetings");
}

/** Disconnect this operator's Microsoft / Outlook account. Just drops the
 *  cached tokens — the next visit shows "Connect Outlook" again. Doesn't
 *  delete existing meetings (you'd lose the brief + notes); just stops the
 *  sync. To revoke from Microsoft's side too, sign out at
 *  https://myaccount.microsoft.com → Connected apps. */
export async function disconnectMicrosoftAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  await serviceClient().from("ms_oauth_tokens").delete().eq("user_id", me.id);
  await flash("success", "Outlook disconnected — Connect again to re-sync");
  revalidatePath("/meetings");
}
