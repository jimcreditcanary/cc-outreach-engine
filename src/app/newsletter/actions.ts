"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { textToHtml } from "@/lib/generate/render";
import { SIGNATURE_TEXT, SIGNATURE_HTML, unsubFooterText, unsubFooterHtml } from "@/lib/generate/config";
import { sendBroadcast } from "@/lib/send/postmark";
import { currentUserId } from "@/lib/auth/owner";
import { flash } from "@/lib/flash";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function createNewsletter(formData: FormData) {
  const subject = str(formData.get("subject")) ?? "Untitled";
  const db = serviceClient();
  const { data, error } = await db
    .from("newsletters")
    .insert({ subject, body_text: "", body_html: "", status: "draft" })
    .select("id")
    .single();
  if (error) throw error;
  await flash("success", `Draft created: ${subject}`);
  revalidatePath("/newsletter");
  redirect(`/newsletter/${data.id}`);
}

export async function updateNewsletter(formData: FormData) {
  const id = String(formData.get("id"));
  const subject = str(formData.get("subject")) ?? "Untitled";
  const body_text = str(formData.get("body_text")) ?? "";
  const body_html = textToHtml(body_text); // re-render on save so preview === sent
  const db = serviceClient();
  const { error } = await db
    .from("newsletters")
    .update({ subject, body_text, body_html, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw error;
  await flash("success", "Issue saved");
  revalidatePath(`/newsletter/${id}`);
}

export async function deleteNewsletter(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  const { error } = await db.from("newsletters").delete().eq("id", id);
  if (error) throw error;
  await flash("success", "Issue deleted");
  revalidatePath("/newsletter");
  redirect("/newsletter");
}

/** Send the newsletter to every opted-in, non-suppressed contact with an
 *  email. Each recipient gets the unsub footer with their email pre-baked
 *  in so /unsubscribe captures feedback the same way as outreach. */
export async function sendNewsletter(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();

  const { data: issue } = await db.from("newsletters").select("*").eq("id", id).maybeSingle();
  if (!issue || issue.status === "sent") return;

  // Persist any unsaved edits first.
  const subject = str(formData.get("subject")) ?? issue.subject;
  const body_text = str(formData.get("body_text")) ?? issue.body_text ?? "";
  const body_html = textToHtml(body_text);
  await db.from("newsletters").update({ subject, body_text, body_html }).eq("id", id);

  const [{ data: subs }, { data: supp }] = await Promise.all([
    db
      .from("contacts")
      .select("id, full_name, email, organisation_id")
      .eq("newsletter_subscribed", true)
      .not("email", "is", null)
      .neq("email_status", "bounced"),
    db.from("suppressions").select("email"),
  ]);
  const suppressed = new Set((supp ?? []).map((s) => String(s.email).toLowerCase()));

  // Newsletter goes out as the operator who hit Send (their FROM / Reply-To).
  const newsletterOwner = await currentUserId();

  let sent = 0;
  for (const c of subs ?? []) {
    const email = String(c.email).toLowerCase();
    if (suppressed.has(email)) continue;

    // Per-recipient unsub footer — the only thing that varies per send.
    const textFinal = `${body_text.trim()}\n\n${SIGNATURE_TEXT}${unsubFooterText(c.email!)}`;
    const htmlFinal = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">
${body_html}
${SIGNATURE_HTML}
${unsubFooterHtml(c.email!)}
</div>`;

    try {
      const res = await sendBroadcast({ to: c.email!, subject, htmlBody: htmlFinal, textBody: textFinal, tag: "newsletter", ownerId: newsletterOwner, trackOpens: true });
      await db.from("events").insert({
        contact_id: c.id,
        organisation_id: c.organisation_id,
        type: "email_sent",
        source: "newsletter",
        payload: { newsletter_id: id, subject, postmark_message_id: res.messageId },
      });
      sent++;
    } catch (e) {
      console.error(`newsletter send failed for ${c.email}: ${(e as Error).message}`);
    }
  }

  await db
    .from("newsletters")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_count: sent })
    .eq("id", id);
  await flash("success", `Newsletter sent to ${sent} subscriber${sent === 1 ? "" : "s"}`);
  revalidatePath(`/newsletter/${id}`);
  revalidatePath("/newsletter");
}

export async function setNewsletterSubscription(formData: FormData) {
  const contactId = String(formData.get("contact_id"));
  const subscribed = formData.get("subscribed") === "on";
  if (!contactId) return;
  const db = serviceClient();
  const { error } = await db
    .from("contacts")
    .update({ newsletter_subscribed: subscribed })
    .eq("id", contactId);
  if (error) throw error;
  await flash("success", subscribed ? "Subscribed to newsletter" : "Unsubscribed from newsletter");
  revalidatePath(`/contacts/${contactId}`);
}
