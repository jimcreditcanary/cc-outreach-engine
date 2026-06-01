"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Save the signed-in operator's outbound sender identity. Upsert so the
 *  first save also creates the row. The new identity applies to every
 *  outbound email owned by this user (queue sends + newsletters). */
export async function saveSenderIdentityAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const from_email = str(formData.get("from_email"));
  const reply_to_email = str(formData.get("reply_to_email"));
  const db = serviceClient();
  const { error } = await db
    .from("user_settings")
    .upsert(
      {
        user_id: me.id,
        from_email,
        reply_to_email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) throw error;
  await flash("success", "Sender identity saved");
  revalidatePath("/settings");
}
