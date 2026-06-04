"use server";

// Server actions for the /replies triage workflow:
//   - assignReplyToContactAction → link an unmatched reply to an existing
//     contact, then re-run the side-effects the inbound webhook would
//     normally do (mark replied, pause sequence, snooze, patch sig).
//   - createContactFromReplyAction → mint a new contact from the
//     unmatched sender, optionally under an existing org or a new one.
//   - dismissReplyAction → quietly mark a triaged reply done so it
//     stops cluttering the list.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { currentUserId } from "@/lib/auth/owner";
import { flash } from "@/lib/flash";
import { snoozeUntil } from "@/lib/cadence/cadence";
import { parseSignature } from "@/lib/inbound/signature";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const REPLY_PAUSE_DAYS = 365;

/** Re-run the "matched reply" side-effects after the operator manually
 *  binds an event to a contact: stamp contact_id/organisation_id on the
 *  event, mark last send replied, pause sequence, snooze, auto-patch sig. */
async function applyReplyEffectsToContact(
  eventId: string,
  contactId: string,
): Promise<void> {
  const db = serviceClient();
  const { data: ev } = await db.from("events").select("payload").eq("id", eventId).maybeSingle();
  const payload = (ev?.payload ?? {}) as { text_body?: string; html_body?: string; signature_parsed?: { mobile?: string | null; job_title?: string | null; linkedin_url?: string | null } };
  const { data: contact } = await db
    .from("contacts")
    .select("organisation_id, mobile, job_title, linkedin_url")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return;

  // Bind the event.
  await db
    .from("events")
    .update({
      contact_id: contactId,
      organisation_id: contact.organisation_id,
      payload: { ...(ev?.payload ?? {}), unmatched: false, manually_assigned_at: new Date().toISOString() },
    })
    .eq("id", eventId);

  // Mark last send replied + pause sequence.
  const { data: lastSend } = await db
    .from("sends")
    .select("id, sequence_id")
    .eq("contact_id", contactId)
    .eq("status", "sent")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastSend) await db.from("sends").update({ replied: true }).eq("id", lastSend.id);
  if (lastSend?.sequence_id) {
    await db.from("sequence_contacts")
      .update({ status: "replied" })
      .eq("sequence_id", lastSend.sequence_id)
      .eq("contact_id", contactId);
  }

  // Auto-patch signature fields IF blank on the contact.
  const sig = payload.signature_parsed ?? parseSignature(payload.text_body ?? payload.html_body ?? "");
  const patch: { mobile?: string; job_title?: string; linkedin_url?: string } = {};
  if (sig.mobile && !contact.mobile) patch.mobile = sig.mobile;
  if (sig.job_title && !contact.job_title) patch.job_title = sig.job_title;
  if (sig.linkedin_url && !contact.linkedin_url) patch.linkedin_url = sig.linkedin_url;
  if (Object.keys(patch).length > 0) {
    await db.from("contacts").update(patch).eq("id", contactId);
  }

  // Snooze the contact — active conversation.
  await db
    .from("contacts")
    .update({ snooze_until: snoozeUntil(new Date(), REPLY_PAUSE_DAYS) })
    .eq("id", contactId);
}

/** Bind an unmatched reply event to an existing contact. */
export async function assignReplyToContactAction(formData: FormData) {
  const eventId = str(formData.get("event_id"));
  const contactId = str(formData.get("contact_id"));
  if (!eventId || !contactId) return;
  await applyReplyEffectsToContact(eventId, contactId);
  await flash("success", "Reply assigned and cadence paused.");
  revalidatePath("/replies");
}

/** Create a brand-new contact from an unmatched reply, then bind. */
export async function createContactFromReplyAction(formData: FormData) {
  const eventId = str(formData.get("event_id"));
  if (!eventId) return;
  const me = await currentUserId();
  const full_name = str(formData.get("full_name"));
  const organisation_id = str(formData.get("organisation_id")); // existing org or null
  const new_org_name = str(formData.get("new_org_name"));        // optional new org

  const db = serviceClient();
  const { data: ev } = await db.from("events").select("payload, owner_id").eq("id", eventId).maybeSingle();
  if (!ev) return;
  const payload = (ev.payload ?? {}) as { from?: string; from_name?: string | null };
  const email = (payload.from ?? "").trim().toLowerCase();
  if (!email) {
    await flash("error", "Reply has no sender email — can't create a contact.");
    revalidatePath("/replies");
    return;
  }

  // Resolve org: pick existing OR create new from name OR leave unlinked.
  let org_id: string | null = organisation_id;
  if (!org_id && new_org_name) {
    const { data: newOrg, error: orgErr } = await db
      .from("organisations")
      .insert({ name: new_org_name, owner_id: me ?? ev.owner_id ?? null })
      .select("id")
      .single();
    if (orgErr) {
      await flash("error", `Couldn't create org: ${orgErr.message}`);
      revalidatePath("/replies");
      return;
    }
    org_id = newOrg.id;
  }

  const { data: newContact, error } = await db
    .from("contacts")
    .insert({
      full_name: full_name ?? payload.from_name ?? email.split("@")[0],
      email,
      organisation_id: org_id,
      owner_id: me ?? ev.owner_id ?? null,
    })
    .select("id")
    .single();
  if (error || !newContact) {
    await flash("error", `Couldn't create contact: ${error?.message ?? "unknown"}`);
    revalidatePath("/replies");
    return;
  }

  await applyReplyEffectsToContact(eventId, newContact.id);
  await flash("success", `Contact created and reply assigned.`);
  revalidatePath("/replies");
  redirect(`/contacts/${newContact.id}`);
}

/** Quietly mark a reply event as triaged (so it stops showing on the
 *  list). Uses a payload flag rather than a separate column. */
export async function dismissReplyAction(formData: FormData) {
  const eventId = str(formData.get("event_id"));
  if (!eventId) return;
  const db = serviceClient();
  const { data: ev } = await db.from("events").select("payload").eq("id", eventId).maybeSingle();
  await db
    .from("events")
    .update({
      payload: { ...(ev?.payload ?? {}), dismissed_at: new Date().toISOString() },
    })
    .eq("id", eventId);
  await flash("success", "Reply dismissed.");
  revalidatePath("/replies");
}
