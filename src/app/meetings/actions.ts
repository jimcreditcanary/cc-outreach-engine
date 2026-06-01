"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { syncCalendar } from "@/lib/meetings/sync";
import { generateMeetingBrief } from "@/lib/meetings/brief";

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
  revalidatePath("/meetings");
}

export async function generateBriefAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  await generateMeetingBrief(serviceClient(), id);
  revalidatePath(`/meetings/${id}`);
}

export async function setSalesRelevantAction(formData: FormData) {
  const id = String(formData.get("id"));
  const relevant = formData.get("relevant") === "true";
  if (!id) return;
  await serviceClient().from("meetings").update({ sales_relevant: relevant }).eq("id", id);
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
  revalidatePath(`/meetings/${id}`);
}

export async function deleteMeetingAction(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("meetings").delete().eq("id", id);
  revalidatePath("/meetings");
  redirect("/meetings");
}
