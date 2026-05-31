"use server";

// Public, unauthenticated action — handles the unsubscribe form submission.
// Two writes: (1) upsert the suppressions row so the email is filtered from
// every future send, (2) snooze every matching contact effectively forever
// so the cadence engine doesn't even consider them.

import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Map a UI choice ("never" / "3" / "6" / "12" months) to an absolute date. */
function resolveRecontactAt(choice: string | null): string | null {
  if (!choice || choice === "never") return null;
  const months = Number(choice);
  if (!Number.isFinite(months) || months <= 0) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export async function submitUnsubscribe(formData: FormData) {
  const email = str(formData.get("email"))?.toLowerCase();
  if (!email) redirect("/unsubscribe?error=missing-email");

  const why = str(formData.get("why"));
  const note = str(formData.get("note"));
  const recontact_at = resolveRecontactAt(str(formData.get("recontact")));

  const db = serviceClient();
  // Suppression row (PK email — upsert handles repeat clicks).
  await db.from("suppressions").upsert(
    { email, reason: "unsubscribe", why, note, recontact_at },
    { onConflict: "email" },
  );
  // Snooze every contact at this email so the generator/sender both skip them.
  // `9999-12-31` is the "never" sentinel; if a recontact_at was chosen we use
  // that instead so they can reappear in the funnel when that date passes.
  // Also clear the newsletter opt-in so monthly broadcasts skip them too.
  const snooze_until = recontact_at ?? "9999-12-31T00:00:00Z";
  await db
    .from("contacts")
    .update({ snooze_until, newsletter_subscribed: false })
    .ilike("email", email);

  redirect("/unsubscribe/thanks");
}
