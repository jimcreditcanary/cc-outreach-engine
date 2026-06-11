"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import {
  ensureSenderSignature,
  getSenderSignature,
  resendSenderConfirmation,
  PostmarkApiError,
} from "@/lib/postmark/signatures";
import { pingToken } from "@/lib/granola/client";
import { syncGranolaForUser, type SyncResult } from "@/lib/granola/sync";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Save the signed-in operator's outbound sender identity AND register the
 *  matching Postmark sender signature in one round-trip. If the API token
 *  isn't configured (or Postmark rejects), the From/Reply-To still saves
 *  — the operator just has to register the signature manually. */
export async function saveSenderIdentityAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const from_email = str(formData.get("from_email"));
  const reply_to_email = str(formData.get("reply_to_email"));
  const db = serviceClient();

  // Persist whatever the operator typed first — independent of Postmark
  // succeeding. We'll overlay signature fields below.
  const baseRow = {
    user_id: me.id,
    from_email,
    reply_to_email,
    updated_at: new Date().toISOString(),
  };
  const { error: saveErr } = await db.from("user_settings").upsert(baseRow, { onConflict: "user_id" });
  if (saveErr) throw saveErr;

  if (!from_email) {
    await flash("success", "Sender identity cleared (falling back to workspace defaults)");
    revalidatePath("/settings");
    return;
  }

  // Register / look up the signature in Postmark. Best-effort — store the
  // result either way so the UI can show the current state next render.
  try {
    const sig = await ensureSenderSignature({ fromEmail: from_email, replyTo: reply_to_email ?? undefined });
    await db.from("user_settings").update({
      postmark_signature_id: String(sig.ID),
      postmark_signature_verified: sig.Confirmed,
      postmark_signature_error: null,
      postmark_signature_checked_at: new Date().toISOString(),
    }).eq("user_id", me.id);
    await flash(
      "success",
      sig.Confirmed
        ? `Sender identity saved — Postmark signature already verified ✓`
        : `Sender identity saved — Postmark sent a confirmation email to ${sig.EmailAddress}. Click the link before your first send.`,
    );
  } catch (e) {
    const msg = e instanceof PostmarkApiError ? `Postmark (${e.status}): ${e.message}` : (e as Error).message;
    console.error("Postmark signature registration failed", e);
    await db.from("user_settings").update({
      postmark_signature_error: msg,
      postmark_signature_checked_at: new Date().toISOString(),
    }).eq("user_id", me.id);
    await flash(
      "error",
      msg.includes("POSTMARK_ACCOUNT_TOKEN")
        ? "Sender saved, but POSTMARK_ACCOUNT_TOKEN isn't set — add it in Vercel to auto-register Postmark signatures."
        : `Sender saved, but Postmark signature failed: ${msg}`,
    );
  }
  revalidatePath("/settings");
}

/** Refresh the signature state from Postmark (the operator clicked the
 *  confirmation email; we want the verified flag to flip true here too). */
export async function refreshSignatureStatusAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const db = serviceClient();
  const { data } = await db.from("user_settings").select("postmark_signature_id").eq("user_id", me.id).maybeSingle();
  const id = data?.postmark_signature_id ? Number(data.postmark_signature_id) : null;
  if (!id) {
    await flash("error", "No Postmark signature on file — save a From address first.");
    revalidatePath("/settings");
    return;
  }
  try {
    const sig = await getSenderSignature(id);
    await db.from("user_settings").update({
      postmark_signature_verified: sig.Confirmed,
      postmark_signature_error: null,
      postmark_signature_checked_at: new Date().toISOString(),
    }).eq("user_id", me.id);
    await flash("success", sig.Confirmed ? "Verified ✓" : "Still pending — check your inbox for the Postmark confirmation email.");
  } catch (e) {
    const msg = e instanceof PostmarkApiError ? `Postmark (${e.status}): ${e.message}` : (e as Error).message;
    await flash("error", `Status check failed: ${msg}`);
  }
  revalidatePath("/settings");
}

/** Save the operator's Granola API key. Pings the API to validate
 *  before persisting — bad key flashes an error, no save. Empty value
 *  is a no-op (use disconnectGranolaAction to explicitly clear). */
export async function saveGranolaTokenAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const token = str(formData.get("granola_api_token"));
  if (!token) {
    await flash("error", "Paste your Granola key to connect, or hit Disconnect to clear.");
    revalidatePath("/settings");
    return;
  }
  const ping = await pingToken(token);
  if (!ping.ok) {
    await flash("error", `Granola rejected the key: ${ping.error ?? "unknown error"}`);
    revalidatePath("/settings");
    return;
  }
  await serviceClient().from("user_settings").upsert(
    { user_id: me.id, granola_api_token: token, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  await flash("success", "Granola connected — sync runs every 15 min.");
  revalidatePath("/settings");
}

/** Explicitly clear the saved key. Existing transcripts + sent follow-ups stay. */
export async function disconnectGranolaAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  await serviceClient().from("user_settings").upsert(
    { user_id: me.id, granola_api_token: null, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  await flash("success", "Granola disconnected.");
  revalidatePath("/settings");
}

/** Manual sync — useful for testing right after connecting. */
export async function syncGranolaNowAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const db = serviceClient();
  const { data } = await db.from("user_settings").select("granola_api_token").eq("user_id", me.id).maybeSingle();
  const token = (data?.granola_api_token as string | null) ?? null;
  if (!token) {
    await flash("error", "No Granola key saved yet.");
    revalidatePath("/settings");
    return;
  }
  const result: SyncResult = {
    operators_checked: 1, notes_seen: 0, meetings_matched: 0,
    transcripts_pulled: 0, followups_sent: 0,
    followups_skipped_low_confidence: 0, errors: [],
  };
  try {
    await syncGranolaForUser(db, me.id, token, result);
  } catch (e) {
    result.errors.push((e as Error).message);
  }
  await flash(
    result.errors.length ? "error" : "success",
    `Granola — ${result.notes_seen} notes · ${result.meetings_matched} matched · ${result.transcripts_pulled} new transcripts · ${result.followups_sent} follow-ups sent${result.followups_skipped_low_confidence ? ` · ${result.followups_skipped_low_confidence} thin` : ""}${result.errors.length ? ` · ${result.errors.length} error(s): ${result.errors[0]}` : ""}`,
  );
  revalidatePath("/settings");
  revalidatePath("/meetings");
}

/** Resend Postmark's confirmation email. Use when the original got lost
 *  to spam or the operator deleted it. */
export async function resendSignatureConfirmationAction() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const db = serviceClient();
  const { data } = await db.from("user_settings").select("postmark_signature_id").eq("user_id", me.id).maybeSingle();
  const id = data?.postmark_signature_id ? Number(data.postmark_signature_id) : null;
  if (!id) {
    await flash("error", "No Postmark signature on file — save a From address first.");
    revalidatePath("/settings");
    return;
  }
  try {
    await resendSenderConfirmation(id);
    await flash("success", "Confirmation email resent — check your inbox.");
  } catch (e) {
    const msg = e instanceof PostmarkApiError ? `Postmark (${e.status}): ${e.message}` : (e as Error).message;
    await flash("error", `Resend failed: ${msg}`);
  }
  revalidatePath("/settings");
}

// ── Booking page (public /book/<slug>) ──────────────────────────────

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Save the operator's public booking-page config. Clearing the link name
 *  takes the page offline (slug null → /book 404s); everything else has
 *  safe defaults so a partial form can't produce a broken page. */
export async function saveBookingSettingsAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");

  const slug = (str(formData.get("booking_slug")) ?? "").toLowerCase().trim().replace(/\s+/g, "-") || null;
  if (slug && !SLUG_RE.test(slug)) {
    await flash("error", "Link name can only use lowercase letters, numbers and hyphens (2–40 chars).");
    revalidatePath("/settings");
    return;
  }

  const dayStart = str(formData.get("booking_day_start")) ?? "09:00";
  const dayEnd = str(formData.get("booking_day_end")) ?? "17:00";
  if (!HM_RE.test(dayStart) || !HM_RE.test(dayEnd) || dayStart >= dayEnd) {
    await flash("error", "Working hours need a start before the end (HH:MM).");
    revalidatePath("/settings");
    return;
  }

  const tz = str(formData.get("booking_tz")) ?? "Europe/London";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    await flash("error", `Unknown timezone "${tz}" — use an IANA name like Europe/London.`);
    revalidatePath("/settings");
    return;
  }

  const days = formData.getAll("booking_days").map((d) => String(d));
  const clamp = (v: FormDataEntryValue | null, def: number, min: number, max: number) => {
    const n = parseInt(String(v ?? ""), 10);
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };

  const { error } = await serviceClient().from("user_settings").upsert(
    {
      user_id: me.id,
      booking_slug: slug,
      booking_duration_mins: clamp(formData.get("booking_duration_mins"), 30, 10, 120),
      booking_buffer_mins: clamp(formData.get("booking_buffer_mins"), 15, 0, 60),
      booking_day_start: dayStart,
      booking_day_end: dayEnd,
      booking_days: days.length > 0 ? days : ["mon", "tue", "wed", "thu", "fri"],
      booking_tz: tz,
      booking_title_template: str(formData.get("booking_title_template")),
      booking_min_notice_hours: clamp(formData.get("booking_min_notice_hours"), 4, 0, 168),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    const taken = error.message.includes("booking_slug");
    await flash("error", taken ? `The link name "${slug}" is already taken by another operator.` : `Couldn't save: ${error.message} — has migration 035 run?`);
  } else if (slug) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
    await flash("success", `Booking page live at ${appUrl}/book/${slug}`);
  } else {
    await flash("success", "Booking page disabled (link name cleared).");
  }
  revalidatePath("/settings");
}
