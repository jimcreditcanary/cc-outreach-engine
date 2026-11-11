"use server";

// Public action for the third-party share flow: the recipient enters their email
// and is sent a one-time, 7-day read-only view link. No auth — the share token is
// the credential. The email + request are logged to the case timeline.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { getActiveShareByToken, issueAccessLink } from "@/lib/onboarding/shares";
import { logCaseEvent } from "@/lib/onboarding/cases";

export async function requestShareAccessAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!token) return redirect("/");
  const base = `/share/${encodeURIComponent(token)}`;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirect(`${base}?error=email`);

  const db = serviceClient();
  const share = await getActiveShareByToken(db, token);
  if (!share) return redirect(`${base}?error=invalid`);

  let companyName: string | null = null;
  try {
    const { data } = await db.from("onboarding_company_snapshot").select("company_name").eq("case_id", share.case_id).maybeSingle();
    companyName = (data as { company_name: string | null } | null)?.company_name ?? null;
  } catch { /* best-effort */ }

  const ok = await issueAccessLink(db, token, email, companyName);
  if (!ok) return redirect(`${base}?error=send`);

  await logCaseEvent(db, share.case_id, "share_link_requested", { email: "external" }, { recipient: email.toLowerCase() }).catch(() => {});
  return redirect(`${base}?sent=1`);
}
