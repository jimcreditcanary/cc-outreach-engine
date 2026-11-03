"use server";

// Server actions for the Work-Deal page (/hot/[id]). Writes straight to HubSpot
// through the repo and revalidates the deal view + the board.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { setDealStage, setDealOwner } from "@/lib/hubspot/repo";

export async function changeDealStageAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = String(formData.get("deal_id") ?? "");
  const stageId = String(formData.get("stage_id") ?? "");
  if (!id || !stageId) return;
  await setDealStage(id, stageId);
  revalidatePath(`/hot/${id}`);
  revalidatePath("/deals");
}

export async function changeDealOwnerAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = String(formData.get("deal_id") ?? "");
  if (!id) return;
  const ownerId = String(formData.get("owner_id") ?? "").trim() || null;
  await setDealOwner(id, ownerId);
  revalidatePath(`/hot/${id}`);
  revalidatePath("/deals");
}
