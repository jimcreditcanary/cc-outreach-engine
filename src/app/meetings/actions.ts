"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { syncCalendar, backfillMeetingLinks } from "@/lib/meetings/sync";
import { syncGoogleCalendar } from "@/lib/google/sync";
import { fetchIcs, isGoogleIcsUrl } from "@/lib/google/calendar";
import { generateMeetingBrief } from "@/lib/meetings/brief";
import { generatePostMeetingSummary } from "@/lib/meetings/postSummary";
import { flash } from "@/lib/flash";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

// Calendar connect/disconnect state renders in two places: the /meetings
// header summary and the Calendars card on /settings.
const revalidateCalendarPages = () => {
  revalidatePath("/meetings");
  revalidatePath("/settings");
};

/** Sync every calendar source this operator has connected. Each source
 *  reports "not connected" through its own ok/reason rather than failing
 *  the whole action, so Outlook-only and Google-only setups both work. */
export async function syncCalendarAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const db = serviceClient();
  const [ms, g] = [
    await syncCalendar(db, me.id).catch((e) => ({ ok: false, reason: (e as Error).message, fetched: 0, upserted: 0, linked_to_contact: 0 })),
    await syncGoogleCalendar(db, me.id).catch((e) => ({ ok: false, reason: (e as Error).message, fetched: 0, upserted: 0, linked_to_contact: 0 })),
  ];
  if (!ms.ok && !g.ok) {
    await flash("error", `Nothing synced. Outlook: ${ms.reason} · Google: ${g.reason}`);
  } else {
    const parts: string[] = [];
    if (ms.ok) parts.push(`Outlook ${ms.upserted} event${ms.upserted === 1 ? "" : "s"} (${ms.linked_to_contact} linked)`);
    if (g.ok) parts.push(`Google ${g.upserted} event${g.upserted === 1 ? "" : "s"} (${g.linked_to_contact} linked)`);
    await flash("success", `Calendar synced — ${parts.join(" · ")}`);
  }
  revalidatePath("/meetings");
}

/** Connect Google Calendar by saving the operator's secret iCal address.
 *  The URL is a capability credential — stored server-side in user_settings
 *  (like the Granola token) and never rendered back to the browser. We
 *  test-fetch before saving so a bad paste fails loudly, then run an
 *  immediate sync so /meetings populates without waiting for the cron. */
export async function connectGoogleCalendarAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const url = str(formData.get("ics_url"));
  if (!url || !isGoogleIcsUrl(url)) {
    await flash("error", "That doesn't look like a Google secret iCal address — it should start with https://calendar.google.com/calendar/ical/… and end in .ics");
    revalidateCalendarPages();
    return;
  }
  try {
    await fetchIcs(url);
  } catch (e) {
    await flash("error", (e as Error).message);
    revalidateCalendarPages();
    return;
  }
  const db = serviceClient();
  const { error } = await db
    .from("user_settings")
    .upsert({ user_id: me.id, google_ics_url: url, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    await flash("error", `Couldn't save: ${error.message} — has migration 034 run?`);
    revalidateCalendarPages();
    return;
  }
  const res = await syncGoogleCalendar(db, me.id).catch((e) => ({ ok: false, reason: (e as Error).message, fetched: 0, upserted: 0, linked_to_contact: 0 }));
  await flash(
    res.ok ? "success" : "error",
    res.ok
      ? `Google Calendar connected — ${res.upserted} event${res.upserted === 1 ? "" : "s"} synced (${res.linked_to_contact} linked to contacts)`
      : `Connected, but first sync failed: ${res.reason}`,
  );
  revalidateCalendarPages();
}

/** Disconnect Google Calendar: drop the stored secret URL. Existing
 *  meetings stay (briefs / transcripts / notes live on them); sync stops.
 *  For belt-and-braces the operator can also reset the secret address on
 *  Google's side, which invalidates the old URL entirely. */
export async function disconnectGoogleCalendarAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  await serviceClient()
    .from("user_settings")
    .upsert({ user_id: me.id, google_ics_url: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  await flash("success", "Google Calendar disconnected — existing meetings kept, sync stopped");
  revalidateCalendarPages();
}

/** Re-link existing meetings whose org / primary contact / deal is null.
 *  Doesn't touch meetings that already have an operator-set link.
 *  Use after importing contacts or adding deals to retro-link past
 *  meetings without re-running the full calendar sync. */
export async function backfillMeetingLinksAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const res = await backfillMeetingLinks(serviceClient());
  const level: "success" | "error" = res.errors.length > 0 ? "error" : "success";
  await flash(
    level,
    `Re-linked ${res.updated}/${res.scanned} meeting${res.scanned === 1 ? "" : "s"}${res.errors.length ? ` · ${res.errors.length} error(s): ${res.errors[0]}` : ""}`,
  );
  revalidatePath("/meetings");
}

export async function generateBriefAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  await generateMeetingBrief(serviceClient(), id);
  await flash("success", "Brief generated");
  revalidatePath(`/meetings/${id}`);
}

/** Save a pasted transcript (and any notes) without running the AI. */
export async function saveTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = str(formData.get("transcript"));
  if (!id) return;
  await serviceClient()
    .from("meetings")
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq("id", id);
  await flash("success", "Transcript saved");
  revalidatePath(`/meetings/${id}`);
}

/** AI post-meeting summary from the pasted transcript. If the meeting is
 *  linked to a deal, the summary is also stored as a note + MEDDICC re-seeds. */
export async function generatePostSummaryAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = str(formData.get("transcript"));
  if (!id) return;
  const db = serviceClient();
  // Persist whatever's in the textarea first so the AI sees the latest paste.
  if (transcript !== null) {
    await db.from("meetings").update({ transcript, updated_at: new Date().toISOString() }).eq("id", id);
  }
  const res = await generatePostMeetingSummary(db, id);
  if (!res) {
    await flash("error", "Add a transcript or notes first, then summarise.");
  } else if (res.meddicc_re_seeded) {
    await flash("success", `Summary generated · MEDDICC re-seeded${res.meddicc_biggest_gap ? ` (gap: ${res.meddicc_biggest_gap})` : ""}`);
  } else {
    await flash("success", "Summary generated");
  }
  revalidatePath(`/meetings/${id}`);
}

export async function setSalesRelevantAction(formData: FormData) {
  const id = String(formData.get("id"));
  const relevant = formData.get("relevant") === "true";
  if (!id) return;
  await serviceClient().from("meetings").update({ sales_relevant: relevant }).eq("id", id);
  await flash("success", relevant ? "Marked sales-relevant" : "Hidden as non-sales");
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
  await flash("success", "Meeting saved");
  revalidatePath(`/meetings/${id}`);
}

export async function deleteMeetingAction(formData: FormData) {
  const id = String(formData.get("id"));
  await serviceClient().from("meetings").delete().eq("id", id);
  await flash("success", "Meeting deleted");
  revalidatePath("/meetings");
  redirect("/meetings");
}

/** Disconnect this operator's Microsoft / Outlook account. Just drops the
 *  cached tokens — the next visit shows "Connect Outlook" again. Doesn't
 *  delete existing meetings (you'd lose the brief + notes); just stops the
 *  sync. To revoke from Microsoft's side too, sign out at
 *  https://myaccount.microsoft.com → Connected apps. */
export async function disconnectMicrosoftAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  await serviceClient().from("ms_oauth_tokens").delete().eq("user_id", me.id);
  await flash("success", "Outlook disconnected — Connect again to re-sync");
  revalidateCalendarPages();
}

/** Convert a not-yet-in-CRM meeting attendee into a real contact, optionally
 *  linked to an existing or new organisation. Updates meetings.attendees JSONB
 *  so the attendee back-references the new contact_id (the "(not in CRM)"
 *  badge disappears on next render). Idempotent: if the email already exists
 *  in contacts we just bind the existing row instead of creating a duplicate. */
export async function addAttendeeToCrmAction(formData: FormData) {
  const meeting_id = str(formData.get("meeting_id"));
  const email = (str(formData.get("email")) ?? "").toLowerCase();
  const full_name = str(formData.get("full_name"));
  const job_title = str(formData.get("job_title"));
  if (!meeting_id || !email) return;

  const me = await currentUser();
  const db = serviceClient();

  // Pick org: existing id from Combobox OR create one from name + sector.
  const organisation_id_in = str(formData.get("organisation_id"));
  const new_org_name = str(formData.get("new_org_name"));
  const sector = str(formData.get("sector"));
  let organisation_id: string | null = organisation_id_in;
  if (!organisation_id && new_org_name) {
    const { data: newOrg, error: orgErr } = await db
      .from("organisations")
      .insert({ name: new_org_name, sector, owner_id: me?.id ?? null })
      .select("id")
      .single();
    if (orgErr) {
      await flash("error", `Couldn't create company: ${orgErr.message}`);
      revalidatePath(`/meetings/${meeting_id}`);
      return;
    }
    organisation_id = newOrg.id;
  }

  // Reuse an existing contact with this email — never duplicate.
  const { data: existing } = await db
    .from("contacts")
    .select("id, organisation_id, owner_id")
    .ilike("email", email)
    .maybeSingle();
  let contact_id: string;
  if (existing) {
    contact_id = existing.id as string;
    // If we resolved an org and the existing contact has none, link it.
    if (organisation_id && !existing.organisation_id) {
      await db.from("contacts").update({ organisation_id }).eq("id", contact_id);
    }
  } else {
    const { data: inserted, error: cErr } = await db
      .from("contacts")
      .insert({
        full_name: full_name ?? email.split("@")[0],
        email,
        job_title,
        organisation_id,
        owner_id: me?.id ?? null,
      })
      .select("id")
      .single();
    if (cErr || !inserted) {
      await flash("error", `Couldn't create contact: ${cErr?.message ?? "unknown"}`);
      revalidatePath(`/meetings/${meeting_id}`);
      return;
    }
    contact_id = inserted.id as string;
  }

  // Stamp the meeting.attendees JSONB so this attendee now back-references
  // the new contact. Re-pull because attendees is jsonb and edits-in-place
  // are awkward via PostgREST.
  const { data: mtg } = await db
    .from("meetings")
    .select("attendees, primary_contact_id, organisation_id")
    .eq("id", meeting_id)
    .maybeSingle();
  if (mtg) {
    type AttRow = { name?: string | null; email?: string | null; response?: string | null; contact_id?: string | null };
    const updated = ((mtg.attendees ?? []) as AttRow[]).map((a) =>
      (a.email ?? "").toLowerCase() === email ? { ...a, contact_id } : a,
    );
    const patch: Record<string, unknown> = { attendees: updated };
    // If the meeting has no primary contact / org yet, this new contact
    // is a sensible default — saves a second manual step.
    if (!mtg.primary_contact_id) patch.primary_contact_id = contact_id;
    if (!mtg.organisation_id && organisation_id) patch.organisation_id = organisation_id;
    await db.from("meetings").update(patch).eq("id", meeting_id);
  }

  await flash("success", existing ? `Linked existing contact: ${full_name ?? email}` : `Added to CRM: ${full_name ?? email}`);
  revalidatePath(`/meetings/${meeting_id}`);
  revalidatePath(`/contacts/${contact_id}`);
}
