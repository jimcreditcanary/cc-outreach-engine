// Secure third-party sharing of the onboarding review (migration 076).
//  • A veepveep user creates a share link for a case and sends it to a third
//    party (the link is the credential).
//  • The recipient opens it, enters their email, and is sent a one-time, 7-day
//    read-only view link via Postmark.
//  • Every email entered and every view is logged (who + when) for the timeline.
// Everything degrades to empty/null (never throws) before the migration is run.

import crypto from "node:crypto";
import type { serviceClient } from "../db/client";
import { sendTransactional } from "../send/postmark";

type DB = ReturnType<typeof serviceClient>;

const ACCESS_TTL_DAYS = 7;
const tok = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");

/** Base URL for the public share pages — the branded host (dd.creditcanary.co.uk)
 *  when set, else the app host. Mirrors merchantFormUrl. */
function shareBaseUrl(): string {
  const base = process.env.ONBOARDING_FORM_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
  return base.replace(/\/$/, "");
}
export function shareUrl(token: string): string {
  return `${shareBaseUrl()}/share/${encodeURIComponent(token)}`;
}
export function shareViewUrl(token: string, accessToken: string): string {
  return `${shareBaseUrl()}/share/${encodeURIComponent(token)}/view?t=${encodeURIComponent(accessToken)}`;
}

export interface ShareAccessRow {
  id: string; recipient_email: string; created_at: string;
  expires_at: string; first_viewed_at: string | null; last_viewed_at: string | null; view_count: number;
}
export interface ShareRow {
  id: string; token: string; label: string | null; created_by_email: string | null;
  revoked_at: string | null; created_at: string; access: ShareAccessRow[];
}

/** Create a share for a case. Returns the row (with its URL) or null on failure. */
export async function createShare(db: DB, caseId: string, createdByEmail: string | null, label?: string | null): Promise<{ id: string; token: string; url: string } | null> {
  try {
    const token = tok();
    const { data, error } = await db.from("onboarding_shares")
      .insert({ case_id: caseId, token, created_by_email: createdByEmail, label: label || null })
      .select("id, token").maybeSingle();
    if (error || !data) return null;
    const row = data as { id: string; token: string };
    return { id: row.id, token: row.token, url: shareUrl(row.token) };
  } catch {
    return null;
  }
}

/** All shares for a case + their access grants (newest first). */
export async function loadShares(db: DB, caseId: string): Promise<ShareRow[]> {
  try {
    const { data: shares } = await db.from("onboarding_shares")
      .select("id, token, label, created_by_email, revoked_at, created_at")
      .eq("case_id", caseId).order("created_at", { ascending: false });
    const rows = (shares as Omit<ShareRow, "access">[] | null) ?? [];
    if (!rows.length) return [];
    const { data: access } = await db.from("onboarding_share_access")
      .select("id, share_id, recipient_email, created_at, expires_at, first_viewed_at, last_viewed_at, view_count")
      .in("share_id", rows.map((r) => r.id)).order("created_at", { ascending: false });
    const byShare = new Map<string, ShareAccessRow[]>();
    for (const a of (access as (ShareAccessRow & { share_id: string })[] | null) ?? []) {
      (byShare.get(a.share_id) ?? byShare.set(a.share_id, []).get(a.share_id)!).push(a);
    }
    return rows.map((r) => ({ ...r, access: byShare.get(r.id) ?? [] }));
  } catch {
    return [];
  }
}

/** Revoke a share (scoped to its case). */
export async function revokeShare(db: DB, caseId: string, shareId: string): Promise<void> {
  try {
    await db.from("onboarding_shares").update({ revoked_at: new Date().toISOString() }).eq("id", shareId).eq("case_id", caseId);
  } catch { /* best-effort */ }
}

/** Resolve an ACTIVE (non-revoked) share by its link token. */
export async function getActiveShareByToken(db: DB, token: string): Promise<{ id: string; case_id: string } | null> {
  try {
    const { data } = await db.from("onboarding_shares").select("id, case_id, revoked_at").eq("token", token.trim()).maybeSingle();
    const row = data as { id: string; case_id: string; revoked_at: string | null } | null;
    if (!row || row.revoked_at) return null;
    return { id: row.id, case_id: row.case_id };
  } catch {
    return null;
  }
}

/** The recipient entered their email: mint a 7-day one-time view link + email it.
 *  Returns true when a link was issued. */
export async function issueAccessLink(db: DB, token: string, email: string, companyName: string | null): Promise<boolean> {
  const share = await getActiveShareByToken(db, token);
  if (!share) return false;
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return false;
  const accessToken = tok(32);
  const expires = new Date(Date.now() + ACCESS_TTL_DAYS * 86_400_000).toISOString();
  try {
    const { error } = await db.from("onboarding_share_access").insert({
      share_id: share.id, recipient_email: clean, access_token: accessToken, expires_at: expires,
    });
    if (error) { console.error("[share] grant insert failed:", error.message); return false; }
  } catch (e) {
    console.error("[share] grant insert threw:", (e as Error)?.message);
    return false;
  }
  // Only report success when the email actually went out — so a failed send
  // surfaces to the recipient (and is logged) instead of a false "check your email".
  return sendShareAccessEmail(clean, shareViewUrl(token, accessToken), companyName);
}

/** Validate a one-time view link. Returns the case + grant, or a reason it failed. */
export async function validateAccess(db: DB, token: string, accessToken: string): Promise<
  | { ok: true; caseId: string; grantId: string; email: string }
  | { ok: false; reason: "invalid" | "expired" }
> {
  const share = await getActiveShareByToken(db, token);
  if (!share) return { ok: false, reason: "invalid" };
  try {
    const { data } = await db.from("onboarding_share_access")
      .select("id, recipient_email, expires_at").eq("access_token", accessToken).eq("share_id", share.id).maybeSingle();
    const row = data as { id: string; recipient_email: string; expires_at: string } | null;
    if (!row) return { ok: false, reason: "invalid" };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
    return { ok: true, caseId: share.case_id, grantId: row.id, email: row.recipient_email };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Record a view against an access grant (first + last + count). */
export async function recordShareView(db: DB, grantId: string): Promise<void> {
  try {
    const { data } = await db.from("onboarding_share_access").select("view_count, first_viewed_at").eq("id", grantId).maybeSingle();
    const row = data as { view_count: number; first_viewed_at: string | null } | null;
    const now = new Date().toISOString();
    await db.from("onboarding_share_access").update({
      view_count: (row?.view_count ?? 0) + 1,
      last_viewed_at: now,
      ...(row?.first_viewed_at ? {} : { first_viewed_at: now }),
    }).eq("id", grantId);
  } catch { /* best-effort */ }
}

async function sendShareAccessEmail(to: string, viewUrl: string, companyName: string | null): Promise<boolean> {
  const subject = `Your secure access link${companyName ? ` — ${companyName}` : ""}`;
  const htmlBody = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1f2937;max-width:560px">
      <p>Hello,</p>
      <p>You requested access to a secure onboarding summary${companyName ? ` for <strong>${escapeHtml(companyName)}</strong>` : ""} shared with you by Credit Canary.</p>
      <p><a href="${viewUrl}" style="display:inline-block;background:#003566;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">View the summary</a></p>
      <p style="color:#6b7280;font-size:13px">This link is valid for 7 days and is for your use only. If it expires, open the original link again and request a new one. If you weren't expecting this, you can ignore this email.</p>
    </div>`;
  const textBody = `Hello,\n\nYou requested access to a secure onboarding summary${companyName ? ` for ${companyName}` : ""} shared with you by Credit Canary.\n\nView it here (valid for 7 days):\n${viewUrl}\n\nIf you weren't expecting this, you can ignore this email.`;
  try {
    const res = await sendTransactional({ to, subject, htmlBody, textBody, tag: "onboarding-share" });
    if (res.dryRun) {
      console.error("[share] email NOT sent — Postmark is in dry-run (POSTMARK_SERVER_TOKEN missing at runtime).");
      return false;
    }
    return true;
  } catch (e) {
    console.error("[share] email send failed:", (e as Error)?.message ?? e);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
