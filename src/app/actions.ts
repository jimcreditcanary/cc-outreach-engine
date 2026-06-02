"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { textToHtml } from "@/lib/generate/render";
import { deriveTier, type DealTierInput } from "@/lib/tier/derive";
import { extractRawText, toMarkdown } from "@/lib/proposals/extract";
import { seedDealMeddicc } from "@/lib/meddicc/seedDeal";
import { regenerateForContact } from "@/lib/generate/forContact";
import { sendBroadcast } from "@/lib/send/postmark";
import { enrichCompany } from "@/lib/enrich/company";
import { flash } from "@/lib/flash";
import { currentUserId } from "@/lib/auth/owner";
import {
  loadCustomFieldDefs,
  parseCustomFieldsFromForm,
  slugify,
  type EntityType,
  type FieldType,
} from "@/lib/customFields";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

type DB = ReturnType<typeof serviceClient>;

/**
 * Append a CRM activity event to the timeline. Best-effort — logging must
 * never block or fail a mutation (and it silently no-ops until migration 010
 * adds the 'crm_change' type + events.deal_id).
 */
async function logEvent(
  db: DB,
  opts: {
    message: string;
    contact_id?: string | null;
    organisation_id?: string | null;
    deal_id?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  try {
    await db.from("events").insert({
      type: "crm_change",
      source: "crm",
      contact_id: opts.contact_id ?? null,
      organisation_id: opts.organisation_id ?? null,
      deal_id: opts.deal_id ?? null,
      payload: { message: opts.message, ...(opts.payload ?? {}) },
    });
  } catch {
    /* timeline logging is best-effort */
  }
}

/** Recompute an org's tier from its deals (mirrors the importer). */
async function rederiveTier(db: DB, organisation_id: string | null) {
  if (!organisation_id) return;
  const { data: deals } = await db
    .from("deals")
    .select("status, proposal_exists")
    .eq("organisation_id", organisation_id);
  const tier = deriveTier((deals ?? []) as DealTierInput[]);
  await db.from("organisations").update({ tier }).eq("id", organisation_id);
}

/** Owner-id read from the edit form, or null for unassigned. Empty string in
 *  the form means the operator explicitly cleared the owner. */
function ownerFromForm(formData: FormData): string | null {
  return str(formData.get("owner_id"));
}

/** Resolve a contact id from a Combobox: either the picked id or a typed
 *  name → creates a new contact attached to the supplied org/owner. Mirrors
 *  resolveCompany's shape so every "create new on the fly" select behaves
 *  the same way. */
async function resolveContact(
  db: DB,
  formData: FormData,
  fieldName: string,
  createField: string,
  ctx: { organisation_id: string | null; owner_id: string | null },
): Promise<string | null> {
  const newName = str(formData.get(createField));
  if (newName) {
    const { data, error } = await db
      .from("contacts")
      .insert({
        full_name: newName,
        organisation_id: ctx.organisation_id,
        owner_id: ctx.owner_id,
        email_status: "unverified",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }
  return str(formData.get(fieldName));
}

/** Resolve a company id from a select value, creating one if a new name was typed. */
async function resolveCompany(db: DB, formData: FormData): Promise<string | null> {
  const newName = str(formData.get("new_organisation_name"));
  if (newName) {
    const { data, error } = await db
      .from("organisations")
      .insert({ name: newName, icp: true })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }
  return str(formData.get("organisation_id"));
}

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
  const { data: snap } = await db.from("sends").select("contact_id, subject").eq("id", id).maybeSingle();
  if (snap) await logEvent(db, { contact_id: snap.contact_id, message: `Email approved: ${snap.subject ?? ""}` });
  await flash("success", "Draft approved — cron will send within the window");
  revalidatePath("/queue");
}

/** Approve many drafts at once. The Outbox pattern: review hundreds, tick
 *  the ones to ship, click once. Skips drafts that are no longer queued
 *  (e.g. someone else just approved them) instead of erroring. */
export async function bulkApproveDrafts(formData: FormData) {
  const ids = formData.getAll("draft_id").map(String).filter(Boolean);
  if (ids.length === 0) {
    await flash("error", "No drafts selected");
    return;
  }
  const db = serviceClient();
  const { data: updated, error } = await db
    .from("sends")
    .update({ status: "approved" })
    .in("id", ids)
    .eq("status", "queued")
    .select("id, contact_id, subject");
  if (error) throw error;
  for (const u of updated ?? []) {
    await logEvent(db, { contact_id: u.contact_id, message: `Email approved (bulk): ${u.subject ?? ""}` });
  }
  const n = updated?.length ?? 0;
  await flash("success", `Approved ${n} draft${n === 1 ? "" : "s"} — cron will send within the window`);
  revalidatePath("/queue");
}

/** Force a draft into the queue for a specific contact, bypassing the
 *  generator's normal selection criteria (sector / tier / pipeline dedup).
 *  Surfaced as a button on the contact page — useful for ad-hoc outreach,
 *  testing, and contacts that don't fit the auto-generator's funnel. */
export async function generateDraftForContact(formData: FormData) {
  const contactId = String(formData.get("contact_id"));
  if (!contactId) return;
  const db = serviceClient();
  const draft = await regenerateForContact(db, contactId);
  if (!draft) return;
  // Look up the asset_id by URL so the click-tracker can attribute clicks.
  const { data: asset } = await db
    .from("content_assets")
    .select("id")
    .eq("url", draft.asset_url)
    .maybeSingle();
  // Inherit owner from the contact so this draft lands in that operator's
  // queue — falls back to the signed-in user if the contact has none yet.
  const { data: ownerRow } = await db.from("contacts").select("owner_id").eq("id", contactId).maybeSingle();
  const owner_id = ownerRow?.owner_id ?? (await currentUserId()) ?? null;
  const { error } = await db.from("sends").insert({
    contact_id: contactId,
    angle: draft.angle,
    asset_id: asset?.id ?? null,
    subject: draft.subject,
    body_html: draft.body_html,
    body_text: draft.body_text,
    original_body_text: draft.body_text,
    status: "queued",
    owner_id,
  });
  if (error) throw error;
  await logEvent(db, { contact_id: contactId, message: `Draft generated on demand: ${draft.subject}` });
  await flash("success", "Draft generated — in the queue");
  revalidatePath(`/contacts/${contactId}`);
  redirect("/queue");
}

/** Re-run the AI for the same contact, replacing the queued draft in place.
 *  Useful when the system prompt / voice spec has changed since the draft
 *  was first generated. */
export async function regenerateDraft(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  const { data: snap } = await db.from("sends").select("contact_id").eq("id", id).eq("status", "queued").maybeSingle();
  if (!snap?.contact_id) return;
  const draft = await regenerateForContact(db, snap.contact_id);
  if (!draft) return;
  const { error } = await db
    .from("sends")
    .update({
      subject: draft.subject,
      body_text: draft.body_text,
      body_html: draft.body_html,
      original_body_text: draft.body_text, // fresh Claude output = new "original"
      angle: draft.angle,
    })
    .eq("id", id);
  if (error) throw error;
  await logEvent(db, { contact_id: snap.contact_id, message: "Draft regenerated" });
  await flash("success", "Draft regenerated");
  revalidatePath("/queue");
}

/** Send a single queued/approved draft NOW (bypasses the warm-up ramp and
 *  daily cap — for ad-hoc sends from the queue button). Suppression list is
 *  still respected. */
export async function sendDraftNow(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  // Persist any edits first so what you see is what gets sent.
  await persistEdits(db, id, formData);
  const { data: row } = await db
    .from("sends")
    .select("id, subject, body_html, body_text, status, owner_id, contact:contacts(id, full_name, email, email_status, organisation_id)")
    .eq("id", id)
    .maybeSingle();
  const c = row?.contact as unknown as { id: string; full_name: string; email: string; email_status: string; organisation_id: string | null } | null;
  if (!row || !c?.email) return;

  const { data: supp } = await db.from("suppressions").select("email").ilike("email", c.email);
  if ((supp ?? []).length > 0 || c.email_status === "bounced") {
    await db.from("sends").update({ status: "suppressed" }).eq("id", id);
    await flash("error", `Not sent — ${c.email} is suppressed/bounced`);
    revalidatePath("/queue");
    return;
  }

  try {
    const res = await sendBroadcast({
      to: c.email,
      subject: row.subject as string,
      htmlBody: row.body_html as string,
      textBody: row.body_text as string,
      tag: "outreach",
      ownerId: (row as { owner_id?: string | null }).owner_id ?? null,
    });
    await db
      .from("sends")
      .update({ status: "sent", postmark_message_id: res.messageId, ts: new Date().toISOString() })
      .eq("id", id);
    await db.from("events").insert({
      contact_id: c.id,
      organisation_id: c.organisation_id,
      type: "email_sent",
      source: "send-now",
      payload: { send_id: id, subject: row.subject },
    });
    const { data: cur } = await db.from("contacts").select("total_touches").eq("id", c.id).single();
    await db
      .from("contacts")
      .update({ last_touched_at: new Date().toISOString(), total_touches: (cur?.total_touches ?? 0) + 1 })
      .eq("id", c.id);
  } catch (e) {
    await db.from("sends").update({ status: "failed" }).eq("id", id);
    await flash("error", `Send failed: ${(e as Error).message}`);
    throw e;
  }
  await flash("success", `Sent to ${c.email}`);
  revalidatePath("/queue");
}

export async function rejectDraft(formData: FormData) {
  const id = String(formData.get("id"));
  const reason = str(formData.get("reason")) ?? "unspecified";
  const note = str(formData.get("note"));
  const db = serviceClient();
  // Snapshot the draft + reason for the style-learning loop (best-effort:
  // never block a reject if the feedback table isn't there yet).
  const { data: snap } = await db
    .from("sends")
    .select("contact_id, subject, body_text, angle")
    .eq("id", id)
    .maybeSingle();
  if (snap) {
    await db.from("draft_rejections").insert({
      send_id: id,
      contact_id: snap.contact_id,
      subject: snap.subject,
      body_text: snap.body_text,
      angle: snap.angle,
      reason,
      note,
    });
    await logEvent(db, { contact_id: snap.contact_id, message: `Draft rejected — ${reason}${note ? `: ${note}` : ""}` });
  }
  await db.from("sends").delete().eq("id", id).eq("status", "queued");
  await flash("info", "Draft rejected — feedback saved");
  revalidatePath("/queue");
}

// ── LinkedIn ────────────────────────────────────────────────────────

/** Persist inline LinkedIn-card edits (name / title / email / mobile /
 *  company [existing or new] / sector / URL) without marking connected. */
export async function saveLinkedInEdits(formData: FormData) {
  const id = String(formData.get("contact_id"));
  if (!id) return;
  const db = serviceClient();
  const organisation_id = await resolveCompany(db, formData);
  const { error } = await db
    .from("contacts")
    .update({
      full_name: str(formData.get("full_name")),
      job_title: str(formData.get("job_title")),
      email: str(formData.get("email")),
      mobile: str(formData.get("mobile")),
      organisation_id,
      linkedin_url: str(formData.get("linkedin_url")),
    })
    .eq("id", id);
  if (error) throw error;
  // Inline sector assignment — useful when the contact lives at a company
  // that has none yet, so the generator stops skipping them.
  const sector = str(formData.get("org_sector"));
  if (sector && organisation_id) {
    await db.from("organisations").update({ sector }).eq("id", organisation_id);
  }
  await logEvent(db, { contact_id: id, organisation_id, message: "LinkedIn details edited" });
  await flash("success", "Saved");
  revalidatePath("/linkedin");
}

/** Flag a contact as not having a LinkedIn presence so they stop appearing
 *  on the /linkedin "Needs research" list. Reversible from the contact's
 *  detail page. */
export async function markNotOnLinkedIn(formData: FormData) {
  const id = String(formData.get("contact_id"));
  if (!id) return;
  const db = serviceClient();
  const { error } = await db
    .from("contacts")
    .update({ not_on_linkedin: true })
    .eq("id", id);
  if (error) throw error;
  await logEvent(db, { contact_id: id, message: "Marked: not on LinkedIn" });
  await flash("success", "Marked — won't appear in LinkedIn research again");
  revalidatePath("/linkedin");
  revalidatePath(`/contacts/${id}`);
}

/** Un-flag — sends the contact back to /linkedin if they still have no URL. */
export async function unmarkNotOnLinkedIn(formData: FormData) {
  const id = String(formData.get("contact_id"));
  if (!id) return;
  const db = serviceClient();
  await db.from("contacts").update({ not_on_linkedin: false }).eq("id", id);
  await flash("success", "Restored to LinkedIn research queue");
  revalidatePath("/linkedin");
  revalidatePath(`/contacts/${id}`);
}

/** Shared persistence for the per-row LinkedIn form: contact edits + inline
 *  sector assignment. Returns the resolved organisation_id so each caller
 *  can stamp it onto the activity event. */
async function persistLinkedInEdits(db: DB, formData: FormData, id: string): Promise<{ organisation_id: string | null }> {
  const organisation_id = await resolveCompany(db, formData);
  const { error } = await db
    .from("contacts")
    .update({
      full_name: str(formData.get("full_name")),
      job_title: str(formData.get("job_title")),
      email: str(formData.get("email")),
      mobile: str(formData.get("mobile")),
      organisation_id,
      linkedin_url: str(formData.get("linkedin_url")),
    })
    .eq("id", id);
  if (error) throw error;
  const sector = str(formData.get("org_sector"));
  if (sector && organisation_id) {
    await db.from("organisations").update({ sector }).eq("id", organisation_id);
  }
  return { organisation_id };
}

/** Sent a connection request via LinkedIn. Counts toward the 15/day cap.
 *  The hook gets logged as the request's opening message so the voice loop
 *  can learn from what worked. */
export async function markLinkedInRequestSent(formData: FormData) {
  const id = String(formData.get("contact_id"));
  if (!id) return;
  const db = serviceClient();
  const { organisation_id } = await persistLinkedInEdits(db, formData, id);
  const hook = str(formData.get("hook"));
  const now = new Date().toISOString();
  await db.from("contacts").update({ linkedin_request_sent_at: now, linkedin_last_touched_at: now }).eq("id", id);
  await db.from("events").insert({
    contact_id: id,
    organisation_id,
    type: "linkedin_note",
    source: "surface",
    payload: { hook: hook ?? "", kind: "request" },
  });
  await logEvent(db, { contact_id: id, organisation_id, message: `LinkedIn connection request sent${hook ? `: "${hook.slice(0, 80)}"` : ""}` });
  await flash("success", "Connection request sent");
  revalidatePath("/linkedin");
}

/** "Already connected on LinkedIn" — moves the contact to the re-engage
 *  queue and DOES NOT count toward the 15/day connection-request cap. */
export async function markLinkedInAlreadyConnected(formData: FormData) {
  const id = String(formData.get("contact_id"));
  if (!id) return;
  const db = serviceClient();
  const { organisation_id } = await persistLinkedInEdits(db, formData, id);
  await db.from("contacts").update({ linkedin_connected: true, linkedin_last_touched_at: new Date().toISOString() }).eq("id", id);
  await db.from("events").insert({
    contact_id: id,
    organisation_id,
    type: "linkedin_note",
    source: "surface",
    payload: { kind: "connected" },
  });
  await logEvent(db, { contact_id: id, organisation_id, message: "Marked: already 1st-degree on LinkedIn" });
  await flash("success", "Marked as already connected — moved to re-engage queue");
  revalidatePath("/linkedin");
}

/** Re-engagement nudge: a follow-up message to an existing 1st-degree.
 *  Doesn't count toward the request cap (no new request), counts toward
 *  the 30/day touches target. */
export async function markLinkedInHookSent(formData: FormData) {
  const id = String(formData.get("contact_id"));
  if (!id) return;
  const db = serviceClient();
  const hook = str(formData.get("hook"));
  const { data: c } = await db.from("contacts").select("organisation_id").eq("id", id).maybeSingle();
  const organisation_id = (c?.organisation_id as string | null) ?? null;
  await db.from("contacts").update({ linkedin_last_touched_at: new Date().toISOString() }).eq("id", id);
  await db.from("events").insert({
    contact_id: id,
    organisation_id,
    type: "linkedin_note",
    source: "surface",
    payload: { hook: hook ?? "", kind: "hook" },
  });
  await logEvent(db, { contact_id: id, organisation_id, message: `LinkedIn re-engagement${hook ? `: "${hook.slice(0, 80)}"` : ""}` });
  await flash("success", "Hook logged");
  revalidatePath("/linkedin");
}

/** @deprecated kept for stale bookmarks. Routes to markLinkedInRequestSent
 *  so behaviour stays the same as the old single button (counts toward 15). */
export async function markLinkedInDone(formData: FormData) {
  await markLinkedInRequestSent(formData);
  return;
}

// ── Custom field defs (Companies / Contacts / Deals) ───────────────

/** Add a new custom field schema entry for a given entity type. The label
 *  is slugified to produce a stable field_key (the jsonb key on entities). */
export async function addCustomFieldDef(formData: FormData) {
  const entity_type = String(formData.get("entity_type")) as EntityType;
  if (!["organisation", "contact", "deal"].includes(entity_type)) return;
  const field_label = str(formData.get("field_label"));
  const field_type = (str(formData.get("field_type")) ?? "text") as FieldType;
  if (!field_label) return;
  const field_key = slugify(field_label);
  if (!field_key) return;
  const optionsRaw = str(formData.get("options"));
  const options =
    field_type === "select" && optionsRaw
      ? optionsRaw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
      : [];

  const { error } = await serviceClient()
    .from("custom_field_defs")
    .insert({ entity_type, field_key, field_label, field_type, options });
  if (error) {
    await flash("error", `Couldn't add field: ${error.message}`);
    return;
  }
  await flash("success", `Custom field added: ${field_label}`);
  // Revalidate every detail page since the def is global to its entity type.
  if (entity_type === "organisation") revalidatePath("/companies");
  else if (entity_type === "contact") revalidatePath("/contacts");
  else if (entity_type === "deal") revalidatePath("/deals");
}

export async function deleteCustomFieldDef(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  const { data: def } = await serviceClient()
    .from("custom_field_defs")
    .select("entity_type, field_label")
    .eq("id", id)
    .maybeSingle();
  const { error } = await serviceClient().from("custom_field_defs").delete().eq("id", id);
  if (error) {
    await flash("error", `Couldn't remove field: ${error.message}`);
    return;
  }
  await flash("success", `Custom field removed${def?.field_label ? `: ${def.field_label}` : ""}`);
  if (def?.entity_type === "organisation") revalidatePath("/companies");
  else if (def?.entity_type === "contact") revalidatePath("/contacts");
  else if (def?.entity_type === "deal") revalidatePath("/deals");
}

/** Collect + coerce the `custom_*` values from FormData using the defs
 *  registered for this entity type. Used inside the entity update actions. */
async function collectCustomFields(
  db: DB,
  entityType: EntityType,
  formData: FormData,
): Promise<Record<string, unknown>> {
  const defs = await loadCustomFieldDefs(db, entityType);
  return parseCustomFieldsFromForm(formData, defs);
}

// ── CRM: organisations ──────────────────────────────────────────────

export async function createOrg(formData: FormData) {
  const name = str(formData.get("name"));
  if (!name) return;
  const db = serviceClient();
  const owner_id = (await currentUserId()) ?? null;
  const { data, error } = await db
    .from("organisations")
    .insert({ name, sector: str(formData.get("sector")), icp: true, owner_id })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent(db, { organisation_id: data.id, message: `Company created: ${name}` });
  await flash("success", `Company created: ${name}`);
  revalidatePath("/companies");
  redirect(`/companies/${data.id}`);
}

export async function updateOrg(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  const custom_fields = await collectCustomFields(db, "organisation", formData);
  const { error } = await db
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
      owner_id: ownerFromForm(formData),
      custom_fields,
    })
    .eq("id", id);
  if (error) throw error;
  await logEvent(db, { organisation_id: id, message: "Company details updated" });
  await flash("success", "Company saved");
  // redirect forces a fresh server render (revalidatePath alone was serving
  // the cached page, which looked like the edit had reverted).
  revalidatePath("/companies");
  redirect(`/companies/${id}`);
}

export async function deleteOrg(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("organisations").delete().eq("id", id);
  await flash("success", "Company deleted");
  revalidatePath("/companies");
  redirect("/companies");
}

/** Scrape the company website + auto-discover their RSS/blog feed,
 *  AI-summarise + store last 5 posts on the org row. */
export async function enrichCompanyAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  const db = serviceClient();
  const res = await enrichCompany(db, id);
  await logEvent(db, {
    organisation_id: id,
    message: `Enriched from web — summary ${res.summary ? "✓" : "—"}, ${res.posts.length} post${res.posts.length === 1 ? "" : "s"} (${res.source.feed ? "RSS" : "no feed"})`,
  });
  await flash("success", `Enriched — summary ${res.summary ? "✓" : "—"}, ${res.posts.length} post${res.posts.length === 1 ? "" : "s"} ${res.source.feed ? "via RSS" : "(no feed)"}`);
  revalidatePath(`/companies/${id}`);
}

/** Merge source org INTO target: re-point all children, then delete source. */
export async function mergeOrg(formData: FormData) {
  const source = String(formData.get("source_id"));
  const target = String(formData.get("target_id"));
  if (!source || !target || source === target) return;
  const db = serviceClient();
  for (const table of ["contacts", "deals", "notes", "events"] as const) {
    const { error } = await db
      .from(table)
      .update({ organisation_id: target })
      .eq("organisation_id", source);
    if (error) throw error;
  }
  const { data: src } = await db.from("organisations").select("name").eq("id", source).maybeSingle();
  const { error } = await db.from("organisations").delete().eq("id", source);
  if (error) throw error;
  await logEvent(db, { organisation_id: target, message: `Merged in duplicate company${src?.name ? `: ${src.name}` : ""}` });
  await flash("success", `Merged ${src?.name ?? "duplicate"} in`);
  revalidatePath("/companies");
  redirect(`/companies/${target}`);
}

// ── CRM: contacts ───────────────────────────────────────────────────

export async function createContact(formData: FormData) {
  const full_name = str(formData.get("full_name"));
  if (!full_name) return;
  const db = serviceClient();
  const organisation_id = await resolveCompany(db, formData);
  const owner_id = (await currentUserId()) ?? null;
  const { data, error } = await db
    .from("contacts")
    .insert({ full_name, email: str(formData.get("email")), organisation_id, owner_id })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent(db, { contact_id: data.id, organisation_id, message: `Contact created: ${full_name}` });
  await flash("success", `Contact created: ${full_name}`);
  revalidatePath("/contacts");
  redirect(`/contacts/${data.id}`);
}

export async function updateContact(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  const organisation_id = await resolveCompany(db, formData);
  const custom_fields = await collectCustomFields(db, "contact", formData);
  const { error } = await db
    .from("contacts")
    .update({
      full_name: str(formData.get("full_name")),
      email: str(formData.get("email")),
      job_title: str(formData.get("job_title")),
      mobile: str(formData.get("mobile")),
      organisation_id,
      linkedin_url: str(formData.get("linkedin_url")),
      label: str(formData.get("label")),
      email_status: str(formData.get("email_status")) ?? "unverified",
      snooze_until: str(formData.get("snooze_until")),
      owner_id: ownerFromForm(formData),
      custom_fields,
    })
    .eq("id", id);
  if (error) throw error;
  await logEvent(db, { contact_id: id, organisation_id, message: "Contact details updated" });
  await flash("success", "Contact saved");
  revalidatePath("/contacts");
  redirect(`/contacts/${id}`);
}

export async function deleteContact(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("contacts").delete().eq("id", id);
  await flash("success", "Contact deleted");
  revalidatePath("/contacts");
  redirect("/contacts");
}

/** Merge source contact INTO target: re-point children, then delete source. */
export async function mergeContact(formData: FormData) {
  const source = String(formData.get("source_id"));
  const target = String(formData.get("target_id"));
  if (!source || !target || source === target) return;
  const db = serviceClient();
  const repoint: [string, string][] = [
    ["deals", "primary_contact_id"],
    ["notes", "contact_id"],
    ["events", "contact_id"],
    ["sends", "contact_id"],
  ];
  for (const [table, col] of repoint) {
    const { error } = await db.from(table).update({ [col]: target }).eq(col, source);
    if (error) throw error;
  }
  const { data: src } = await db.from("contacts").select("full_name").eq("id", source).maybeSingle();
  const { error } = await db.from("contacts").delete().eq("id", source);
  if (error) throw error;
  await logEvent(db, { contact_id: target, message: `Merged in duplicate contact${src?.full_name ? `: ${src.full_name}` : ""}` });
  await flash("success", `Merged ${src?.full_name ?? "duplicate"} in`);
  revalidatePath("/contacts");
  redirect(`/contacts/${target}`);
}

// ── CRM: notes ──────────────────────────────────────────────────────

/** Add a free-text note against any combination of company / contact / deal. */
export async function addNote(formData: FormData) {
  const content = str(formData.get("content"));
  const organisation_id = str(formData.get("organisation_id"));
  const contact_id = str(formData.get("contact_id"));
  const deal_id = str(formData.get("deal_id"));
  if (!content) return;
  const db = serviceClient();
  const owner_id = (await currentUserId()) ?? null;

  // When the note is filed against a deal but the caller didn't pass an org,
  // derive it from the deal so MEDDICC re-seeding + the org timeline both
  // pick it up.
  let derivedOrgId = organisation_id;
  if (deal_id && !derivedOrgId) {
    const { data: d } = await db.from("deals").select("organisation_id").eq("id", deal_id).maybeSingle();
    derivedOrgId = d?.organisation_id as string | null;
  }

  const { error } = await db.from("notes").insert({
    content,
    organisation_id: derivedOrgId,
    contact_id,
    deal_id,
    author: "Jim",
    noted_at: new Date().toISOString(),
    owner_id,
  });
  if (error) throw error;
  await logEvent(db, { contact_id, organisation_id: derivedOrgId, deal_id, message: `Note added: ${content.slice(0, 80)}` });

  // Notes are the main fresh signal between proposal and close — re-seed
  // MEDDICC for any live deal on this org so /deals always reflects the
  // latest. Best-effort so a model hiccup never blocks the note save.
  if (derivedOrgId) {
    try {
      const { data: live } = await db
        .from("deals")
        .select("id")
        .eq("organisation_id", derivedOrgId)
        .eq("status", "open")
        .eq("proposal_exists", true);
      for (const d of live ?? []) {
        const gap = await seedDealMeddicc(db, d.id);
        if (gap) await logEvent(db, { organisation_id: derivedOrgId, deal_id: d.id, message: `MEDDICC re-seeded after new note (gap: ${gap})` });
      }
    } catch (e) {
      console.error("MEDDICC re-seed on note failed", e);
    }
  }

  await flash("success", "Note added");
  if (deal_id) revalidatePath(`/deals/${deal_id}`);
  if (contact_id) revalidatePath(`/contacts/${contact_id}`);
  if (derivedOrgId) revalidatePath(`/companies/${derivedOrgId}`);
}

export async function updateNote(formData: FormData) {
  const id = String(formData.get("id"));
  const content = str(formData.get("content"));
  const back = str(formData.get("back"));
  if (!content) return;
  const db = serviceClient();
  const { data: n } = await db.from("notes").select("organisation_id, contact_id").eq("id", id).maybeSingle();
  const { error } = await db.from("notes").update({ content }).eq("id", id);
  if (error) throw error;
  await logEvent(db, { contact_id: n?.contact_id, organisation_id: n?.organisation_id, message: "Note edited" });
  await flash("success", "Note saved");
  if (back) revalidatePath(back);
}

export async function deleteNote(formData: FormData) {
  const id = String(formData.get("id"));
  const back = str(formData.get("back"));
  const db = serviceClient();
  const { data: n } = await db.from("notes").select("organisation_id, contact_id").eq("id", id).maybeSingle();
  const { error } = await db.from("notes").delete().eq("id", id);
  if (error) throw error;
  await logEvent(db, { contact_id: n?.contact_id, organisation_id: n?.organisation_id, message: "Note deleted" });
  await flash("success", "Note deleted");
  if (back) revalidatePath(back);
}

// ── CRM: deals ──────────────────────────────────────────────────────

export async function createDeal(formData: FormData) {
  const title = str(formData.get("title"));
  const organisation_id = str(formData.get("organisation_id"));
  if (!title || !organisation_id) return;
  const db = serviceClient();
  const tcvIn = formData.get("tcv") ?? formData.get("value");
  const owner_id = (await currentUserId()) ?? null;
  const { data, error } = await db
    .from("deals")
    .insert({
      title,
      organisation_id,
      status: str(formData.get("status")) ?? "open",
      stage: str(formData.get("stage")),
      value: formData.get("value") ? Number(formData.get("value")) : tcvIn ? Number(tcvIn) : null,
      tcv: tcvIn ? Number(tcvIn) : null,
      arr: formData.get("arr") ? Number(formData.get("arr")) : null,
      owner_id,
    })
    .select("id")
    .single();
  if (error) throw error;
  await rederiveTier(db, organisation_id);
  await logEvent(db, { organisation_id, deal_id: data.id, message: `Deal created: ${title}` });
  await flash("success", `Deal created: ${title}`);
  revalidatePath(`/companies/${organisation_id}`);
  redirect(`/deals/${data.id}`);
}

export async function updateDeal(formData: FormData) {
  const id = String(formData.get("id"));
  const db = serviceClient();
  // resolveCompany handles "new_organisation_name" → creates + returns id,
  // otherwise falls back to the picked organisation_id. Same helper used
  // by createContact / updateContact so the "or type a new one" pattern
  // behaves identically across the CRM.
  const organisation_id = await resolveCompany(db, formData);
  const prevOrg = str(formData.get("prev_organisation_id"));
  const custom_fields = await collectCustomFields(db, "deal", formData);
  const owner_id = ownerFromForm(formData);
  // Primary contact: picked from the Combobox OR typed-new → created and
  // attached to this deal's org + owner. Same waterfall as resolveCompany.
  const primary_contact_id = await resolveContact(db, formData, "primary_contact_id", "new_primary_contact_name", {
    organisation_id,
    owner_id,
  });
  const { error } = await db
    .from("deals")
    .update({
      title: str(formData.get("title")),
      status: str(formData.get("status")) ?? "open",
      stage: str(formData.get("stage")),
      value: formData.get("tcv") ? Number(formData.get("tcv")) : formData.get("value") ? Number(formData.get("value")) : null,
      tcv: formData.get("tcv") ? Number(formData.get("tcv")) : null,
      arr: formData.get("arr") ? Number(formData.get("arr")) : null,
      organisation_id,
      primary_contact_id,
      owner_id,
      custom_fields,
    })
    .eq("id", id);
  if (error) throw error;
  await rederiveTier(db, organisation_id);
  if (prevOrg && prevOrg !== organisation_id) await rederiveTier(db, prevOrg);
  await logEvent(db, { organisation_id, deal_id: id, message: "Deal updated" });
  await flash("success", "Deal saved");
  revalidatePath("/deals");
  redirect(`/deals/${id}`);
}

/** Inline status change from the company page (no full deal edit needed). */
export async function setDealStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = str(formData.get("status")) ?? "open";
  const db = serviceClient();
  const { data: deal, error } = await db
    .from("deals")
    .update({ status })
    .eq("id", id)
    .select("organisation_id")
    .single();
  if (error) throw error;
  await rederiveTier(db, deal.organisation_id);
  await logEvent(db, { organisation_id: deal.organisation_id, deal_id: id, message: `Deal status → ${status}` });
  await flash("success", `Deal status → ${status}`);
  if (deal.organisation_id) revalidatePath(`/companies/${deal.organisation_id}`);
  revalidatePath("/deals");
}

export async function deleteDeal(formData: FormData) {
  const id = String(formData.get("id"));
  const organisation_id = str(formData.get("organisation_id"));
  const db = serviceClient();
  const { data: d } = await db.from("deals").select("title").eq("id", id).maybeSingle();
  const { error } = await db.from("deals").delete().eq("id", id);
  if (error) throw error;
  await rederiveTier(db, organisation_id);
  await logEvent(db, { organisation_id, message: `Deal deleted${d?.title ? `: ${d.title}` : ""}` });
  await flash("success", `Deal deleted${d?.title ? `: ${d.title}` : ""}`);
  revalidatePath("/deals");
  redirect("/deals");
}

export async function addDealContact(formData: FormData) {
  const deal_id = String(formData.get("deal_id"));
  const role = str(formData.get("role"));
  if (!deal_id) return;
  const db = serviceClient();
  // Look up the deal's org + owner so a typed-new contact lands on the right
  // company without the operator having to repeat themselves.
  const { data: d } = await db.from("deals").select("organisation_id, owner_id").eq("id", deal_id).maybeSingle();
  const contact_id = await resolveContact(db, formData, "contact_id", "new_contact_name", {
    organisation_id: (d?.organisation_id as string | null) ?? null,
    owner_id: (d?.owner_id as string | null) ?? null,
  });
  if (!contact_id) return;
  const { error } = await db
    .from("deal_contacts")
    .upsert({ deal_id, contact_id, role }, { onConflict: "deal_id,contact_id" });
  if (error) throw error;
  await logEvent(db, { deal_id, contact_id, message: `Added deal stakeholder${role ? ` (${role})` : ""}` });
  await flash("success", `Stakeholder added${role ? ` as ${role}` : ""}`);
  revalidatePath(`/deals/${deal_id}`);
}

export async function removeDealContact(formData: FormData) {
  const deal_id = String(formData.get("deal_id"));
  const contact_id = String(formData.get("contact_id"));
  const db = serviceClient();
  const { error } = await db
    .from("deal_contacts")
    .delete()
    .eq("deal_id", deal_id)
    .eq("contact_id", contact_id);
  if (error) throw error;
  await logEvent(db, { deal_id, contact_id, message: "Removed deal stakeholder" });
  await flash("success", "Stakeholder removed");
  revalidatePath(`/deals/${deal_id}`);
}

/** VP-sales beast-mode answer flow: Jim types the answer to the current
 *  MEDDICC gap-closing question; we log it as a note, then re-seed MEDDICC
 *  so the new context flows into the fields + a fresh biggest-gap surfaces. */
export async function answerMeddiccGap(formData: FormData) {
  const deal_id = String(formData.get("deal_id"));
  const answer = str(formData.get("answer"));
  const question = str(formData.get("question"));
  if (!deal_id || !answer) return;
  const db = serviceClient();
  const { data: deal } = await db
    .from("deals")
    .select("organisation_id, title")
    .eq("id", deal_id)
    .maybeSingle();
  if (!deal) return;
  const noteContent = `[deal: ${deal.title ?? deal_id}] MEDDICC Q&A\nQ: ${question ?? "(prior question)"}\nA: ${answer}`;
  await db.from("notes").insert({
    organisation_id: deal.organisation_id,
    content: noteContent,
    author: "Jim",
    noted_at: new Date().toISOString(),
  });
  const gap = await seedDealMeddicc(db, deal_id);
  await logEvent(db, {
    organisation_id: deal.organisation_id,
    deal_id,
    message: `MEDDICC answered → new gap: ${gap ?? "(fully qualified)"}`,
  });
  await flash("success", `MEDDICC re-qualified — new gap: ${gap ?? "(fully qualified)"}`);
  revalidatePath("/hot");
}

/** Re-seed MEDDICC on demand for a single deal (button on the deal page). */
export async function reseedDealMeddicc(formData: FormData) {
  const dealId = String(formData.get("deal_id"));
  if (!dealId) return;
  const db = serviceClient();
  const gap = await seedDealMeddicc(db, dealId);
  const { data: d } = await db.from("deals").select("organisation_id").eq("id", dealId).maybeSingle();
  if (gap) await logEvent(db, { organisation_id: d?.organisation_id, deal_id: dealId, message: `MEDDICC re-seeded manually (gap: ${gap})` });
  await flash("success", gap ? `MEDDICC re-seeded — gap: ${gap}` : "MEDDICC re-seeded");
  revalidatePath(`/deals/${dealId}`);
}

/** Upload a proposal file → extract → render to markdown → attach to deal,
 *  then automatically seed MEDDICC (no manual `npm run meddicc` needed). */
export async function uploadProposal(formData: FormData) {
  const dealId = String(formData.get("deal_id"));
  const file = formData.get("file");
  if (!dealId || !(file instanceof File) || file.size === 0) return;
  const buf = Buffer.from(await file.arrayBuffer());
  const raw = await extractRawText(buf, file.name);
  const md = await toMarkdown(raw, file.name);
  const db = serviceClient();
  const { data: deal, error } = await db
    .from("deals")
    .update({ proposal_text: md, proposal_exists: true })
    .eq("id", dealId)
    .select("organisation_id")
    .single();
  if (error) throw error;
  await rederiveTier(db, deal.organisation_id);
  await logEvent(db, { organisation_id: deal.organisation_id, deal_id: dealId, message: `Proposal attached: ${file.name}` });
  // Auto-seed MEDDICC from the freshly-attached proposal. Best-effort so a
  // model hiccup never loses the upload itself.
  try {
    const gap = await seedDealMeddicc(db, dealId);
    if (gap) await logEvent(db, { organisation_id: deal.organisation_id, deal_id: dealId, message: `MEDDICC auto-seeded (biggest gap: ${gap})` });
  } catch (e) {
    console.error("auto-seed MEDDICC failed", e);
  }
  await flash("success", `Proposal attached + MEDDICC seeded`);
  // Redirect (not just revalidate) so the file input clears + the page
  // visibly re-renders with the new "proposal attached" badge.
  revalidatePath(`/deals/${dealId}`);
  redirect(`/deals/${dealId}?uploaded=1`);
}
