"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { currentUserId } from "@/lib/auth/owner";
import { parseTabular } from "@/lib/import/parse";
import { normalizeHeader } from "@/lib/import/headers";
import { matchAttendees, buildCompanyOwnerMap, type AttendeeRow } from "@/lib/conferences/matchAttendees";
import { flash } from "@/lib/flash";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function createConferenceAction(formData: FormData) {
  const name = str(formData.get("name"));
  if (!name) return;
  const owner_id = (await currentUserId()) ?? null;
  const { data, error } = await serviceClient()
    .from("conferences")
    .insert({
      name,
      location: str(formData.get("location")),
      start_date: str(formData.get("start_date")),
      end_date: str(formData.get("end_date")),
      owner_id,
    })
    .select("id")
    .single();
  if (error) throw error;
  await flash("success", `Event created: ${name}`);
  revalidatePath("/events");
  redirect(`/events/${data.id}`);
}

export async function updateConferenceAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  const { error } = await serviceClient()
    .from("conferences")
    .update({
      name: str(formData.get("name")) ?? "(unnamed)",
      location: str(formData.get("location")),
      start_date: str(formData.get("start_date")),
      end_date: str(formData.get("end_date")),
      notes: str(formData.get("notes")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  await flash("success", "Event saved");
  revalidatePath(`/events/${id}`);
}

export async function deleteConferenceAction(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("conferences").delete().eq("id", id);
  await flash("success", "Event deleted");
  revalidatePath("/events");
  redirect("/events");
}

/** Set the operators attending a conference. Whole-set semantics: the form
 *  posts every checked user_id; we delete what's missing + insert what's
 *  new in one transaction-ish pass. Attending operators get round-robin
 *  ownership of uploaded attendees, divided by company. */
export async function setConferenceOperatorsAction(formData: FormData) {
  const conference_id = String(formData.get("conference_id"));
  const userIds = formData.getAll("user_id").map(String).filter(Boolean);
  if (!conference_id) return;
  try {
    const db = serviceClient();
    // Replace the existing set.
    const { error: delErr } = await db.from("conference_operators").delete().eq("conference_id", conference_id);
    if (delErr) throw delErr;
    if (userIds.length) {
      const rows = userIds.map((user_id) => ({ conference_id, user_id }));
      const { error } = await db.from("conference_operators").insert(rows);
      if (error) throw error;
    }
    await flash("success", `${userIds.length} operator${userIds.length === 1 ? "" : "s"} attending`);
  } catch (e) {
    const msg = (e as { message?: string; code?: string })?.message ?? String(e);
    const code = (e as { code?: string })?.code;
    console.error("setConferenceOperators failed", { code, msg });
    await flash(
      "error",
      code === "42P01"
        ? "Database missing: run migration 022 (conference_operators table) in Supabase SQL Editor"
        : `Save attending failed: ${msg}`,
    );
  }
  revalidatePath(`/events/${conference_id}`);
}

export async function removeAttendeeAction(formData: FormData) {
  const conference_id = String(formData.get("conference_id"));
  const contact_id = String(formData.get("contact_id"));
  if (!conference_id || !contact_id) return;
  await serviceClient().from("conference_attendances").delete()
    .eq("conference_id", conference_id).eq("contact_id", contact_id);
  await flash("success", "Attendee removed from event");
  revalidatePath(`/events/${conference_id}`);
}

/** Upload a CSV/xlsx of attendees. Each row is resolved to a contact via
 *  the email → name+company → create → needs_research waterfall. The
 *  resolved contact_ids are upserted into conference_attendances so re-runs
 *  with the same file are idempotent. */
export async function uploadAttendeesAction(formData: FormData) {
  const conference_id = String(formData.get("conference_id"));
  const file = formData.get("file");
  if (!conference_id || !(file instanceof File) || file.size === 0) return;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const raw = parseTabular(buf, file.name);
    if (raw.length === 0) {
      await flash("error", "No rows found in the uploaded file");
      revalidatePath(`/events/${conference_id}`);
      return;
    }

    // Normalise each row's keys → snake_case so a header of "Full Name" or
    // "First Name + Last Name" both reach us as the same lookup keys.
    const rows: AttendeeRow[] = raw.map((r) => {
      const out: AttendeeRow = {};
      for (const [k, v] of Object.entries(r)) {
        const key = normalizeHeader(k);
        const val = String(v ?? "").trim();
        if (!val) continue;
        if (["email", "email_address", "e_mail"].includes(key)) out.email = val;
        else if (["full_name", "name", "attendee", "attendee_name"].includes(key)) out.full_name = val;
        else if (["first_name", "firstname"].includes(key)) out.full_name = (out.full_name ?? "") ? `${val} ${out.full_name}` : val;
        else if (["last_name", "lastname", "surname"].includes(key)) out.full_name = out.full_name ? `${out.full_name} ${val}` : val;
        else if (["job_title", "title", "role", "position"].includes(key)) out.job_title = val;
        else if (["company", "organisation", "organization", "employer", "company_name"].includes(key)) out.company = val;
      }
      return out;
    });

    const db = serviceClient();
    const uploader = (await currentUserId()) ?? null;

    // Round-robin distribution: if operators are attending, divide companies
    // between them so every contact at a given company shares one owner who
    // owns the follow-up. Falls back to the uploader otherwise.
    const { data: attending, error: opsErr } = await db
      .from("conference_operators")
      .select("user_id")
      .eq("conference_id", conference_id);
    // Missing-table is recoverable: just behave as if no operators attending.
    const opsErrCode = (opsErr as { code?: string } | null)?.code;
    if (opsErr && opsErrCode !== "42P01") throw opsErr;
    const operatorIds = (attending ?? []).map((r) => r.user_id as string);
    const { ownerForRow, ownerForCompany } = buildCompanyOwnerMap(rows, operatorIds);

    const summary = await matchAttendees(db, rows, uploader, operatorIds.length ? ownerForRow : undefined);

    // Persist the attendances. Upsert on the composite PK so re-uploads of
    // the same list don't error — they just keep the original matched_via.
    const inserts = summary.outcomes.map((o) => ({
      conference_id,
      contact_id: o.contact_id,
      matched_via: o.matched_via,
    }));
    if (inserts.length) {
      const { error } = await db
        .from("conference_attendances")
        .upsert(inserts, { onConflict: "conference_id,contact_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    const { counts, skipped } = summary;
    const distribution = operatorIds.length
      ? ` Distributed across ${operatorIds.length} operator${operatorIds.length === 1 ? "" : "s"} (${ownerForCompany.size} compan${ownerForCompany.size === 1 ? "y" : "ies"} round-robin'd).`
      : "";
    await flash(
      "success",
      `Imported ${inserts.length} attendee${inserts.length === 1 ? "" : "s"} — ${counts.email} matched by email, ${counts.name_company} by name, ${counts.created} created, ${counts.needs_research} need research${skipped ? `, ${skipped} skipped` : ""}.${distribution}`,
    );
  } catch (e) {
    const err = e as { message?: string; code?: string; details?: string; hint?: string };
    console.error("uploadAttendees failed", { code: err.code, msg: err.message, details: err.details, hint: err.hint });
    const hint =
      err.code === "42P01" ? " — run the matching migration (021 / 022) in Supabase SQL Editor"
      : err.code === "23502" ? " — required column is null"
      : err.code === "23503" ? " — foreign key reference doesn't exist"
      : err.code === "23505" ? " — duplicate row"
      : "";
    await flash("error", `Upload failed: ${err.message ?? "unknown error"}${hint}`);
  }
  revalidatePath(`/events/${conference_id}`);
}
