"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { textToHtml } from "@/lib/generate/render";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

// ── Approval queue ──────────────────────────────────────────────────

/** Persist edited subject/body if the form carried them. */
async function persistEdits(db: ReturnType<typeof serviceClient>, id: string, form: FormData) {
  const subject = str(form.get("subject"));
  const body_text = str(form.get("body_text"));
  if (subject === null && body_text === null) return;
  const patch: Record<string, unknown> = {};
  if (subject !== null) patch.subject = subject;
  if (body_text !== null) {
    patch.body_text = body_text;
    patch.body_html = textToHtml(body_text);
  }
  await db.from("sends").update(patch).eq("id", id).eq("status", "queued");
}

export async function updateDraft(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  await persistEdits(db, id, formData);
  revalidatePath("/queue");
}

export async function approveDraft(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  await persistEdits(db, id, formData); // save any edits, then approve
  await db.from("sends").update({ status: "approved" }).eq("id", id).eq("status", "queued");
  revalidatePath("/queue");
}

export async function rejectDraft(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  await db.from("sends").delete().eq("id", id).eq("status", "queued");
  revalidatePath("/queue");
}

// ── LinkedIn ────────────────────────────────────────────────────────

export async function saveLinkedInHook(formData: FormData) {
  const contactId = String(formData.get("contact_id"));
  const orgId = (formData.get("organisation_id") as string) || null;
  const hook = String(formData.get("hook") ?? "").trim();
  if (!contactId) return;
  const db = serviceClient();
  await db.from("events").insert({
    contact_id: contactId,
    organisation_id: orgId,
    type: "linkedin_note",
    source: "surface",
    payload: { hook },
  });
  await db.from("contacts").update({ linkedin_connected: true }).eq("id", contactId);
  revalidatePath("/linkedin");
}

// ── CRM: organisations ──────────────────────────────────────────────

export async function updateOrg(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  await db
    .from("organisations")
    .update({
      name: str(formData.get("name")) ?? "(unnamed)",
      sector: str(formData.get("sector")),
      website: str(formData.get("website")),
      location: str(formData.get("location")),
      label: str(formData.get("label")),
      is_partner: formData.get("is_partner") === "on",
      top_line_notes: str(formData.get("top_line_notes")),
      customer_category: str(formData.get("customer_category")),
      customer_sub_category: str(formData.get("customer_sub_category")),
      industry: str(formData.get("industry")),
    })
    .eq("id", id);
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}

export async function deleteOrg(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("organisations").delete().eq("id", id);
  revalidatePath("/companies");
  redirect("/companies");
}

// ── CRM: contacts ───────────────────────────────────────────────────

export async function updateContact(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  await db
    .from("contacts")
    .update({
      full_name: str(formData.get("full_name")),
      email: str(formData.get("email")),
      job_title: str(formData.get("job_title")),
      linkedin_url: str(formData.get("linkedin_url")),
      label: str(formData.get("label")),
      email_status: str(formData.get("email_status")) ?? "unverified",
      is_deal_stakeholder: formData.get("is_deal_stakeholder") === "on",
      snooze_until: str(formData.get("snooze_until")),
    })
    .eq("id", id);
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
}

export async function deleteContact(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("contacts").delete().eq("id", id);
  revalidatePath("/contacts");
  redirect("/contacts");
}
