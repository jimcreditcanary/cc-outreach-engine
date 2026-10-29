// Lead call-invite: the instant "fancy a quick call?" email sent to a lead on
// capture, plus the 48h / 7-day chase copy and the "just give me sandbox access"
// opt-out. Booking happens via Jim's HubSpot meetings link; the chase cron
// (./chase.ts) stops the sequence once they book or opt for sandbox.
//
// GATED by LEAD_INVITE_ENABLED: until it's "true" nothing is sent to a real
// lead, and capture keeps its current behaviour (the legacy auto-draft). This
// is the deliberate go-live switch for an outward-facing automated email.

import crypto from "node:crypto";
import type { serviceClient } from "../db/client";
import { sendTransactional } from "../send/postmark";
import { SIGNATURE_HTML, SIGNATURE_TEXT } from "../send/signature";

type DB = ReturnType<typeof serviceClient>;

export function inviteEnabled(): boolean {
  return process.env.LEAD_INVITE_ENABLED === "true";
}

function meetingsUrl(): string {
  return process.env.LEAD_INVITE_MEETINGS_URL ?? "https://meetings-eu1.hubspot.com/jim-fell";
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
}

export function sandboxUrl(token: string): string {
  return `${appUrl()}/api/leads/sandbox?token=${encodeURIComponent(token)}`;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface InviteFields {
  firstName: string;
  company: string | null;
  asset: string | null;
  token: string;
}

export type InviteStage = "invite" | "chase_48h" | "chase_7d";

interface EmailContent {
  subject: string;
  textBody: string;
  htmlBody: string;
}

/** Shared HTML shell — paragraphs + two CTA links, plain and legible (it's a
 *  transactional note "from Jim", not a designed marketing email). */
function renderHtml(paras: string[], bookUrl: string, sbUrl: string): string {
  const body = paras.map((p) => `<p style="margin:0 0 16px;">${p}</p>`).join("");
  const btn = (href: string, label: string, primary: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:10px 18px;margin:0 8px 8px 0;border-radius:6px;` +
    `text-decoration:none;font-weight:600;${primary ? "background:#0B1F3A;color:#ffffff;" : "background:#eef1f6;color:#0B1F3A;"}">${esc(label)}</a>`;
  return (
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px;">` +
    body +
    `<p style="margin:0 0 20px;">${btn(bookUrl, "Book a time", true)}${btn(sbUrl, "Just give me sandbox access", false)}</p>` +
    `<p style="margin:0;color:#555;">Best,</p>` +
    SIGNATURE_HTML +
    `</div>`
  );
}

export function buildInviteEmail(stage: InviteStage, f: InviteFields): EmailContent {
  const book = meetingsUrl();
  const sb = sandboxUrl(f.token);
  const company = f.company?.trim() || "your team";
  const assetClause = f.asset?.trim() ? ` and grabbing "${f.asset.trim()}"` : "";

  if (stage === "chase_48h") {
    const paras = [
      `Hi ${f.firstName},`,
      `Quick nudge — the offer of a 20-minute walk-through still stands, and I can tailor it to ${company}.`,
      `Or if you'd rather skip the call, I'll just get you sandbox access to try the API directly.`,
    ];
    return {
      subject: "Still keen to see Credit Canary?",
      textBody: toText(paras, book, sb),
      htmlBody: renderHtml(paras.map(esc), book, sb),
    };
  }

  if (stage === "chase_7d") {
    const paras = [
      `Hi ${f.firstName},`,
      `I won't keep chasing. If it's useful, here's the link to book a quick call or to get sandbox access — otherwise I'll leave it with you.`,
    ];
    return {
      subject: "Last one from me — Credit Canary",
      textBody: toText(paras, book, sb),
      htmlBody: renderHtml(paras.map(esc), book, sb),
    };
  }

  const paras = [
    `Hi ${f.firstName},`,
    `Thanks for taking a look at Credit Canary${assetClause}.`,
    `If it's useful, grab 20 minutes with me and I'll show you how it'd work for ${company}.`,
    `Rather just get your hands on it? I'll set you up with sandbox access to try the API directly — no call needed.`,
    `Either way, reply to this email if you've got questions.`,
  ];
  return {
    subject: "Want a quick look at Credit Canary?",
    textBody: toText(paras, book, sb),
    htmlBody: renderHtml(paras.map(esc), book, sb),
  };
}

function toText(paras: string[], bookUrl: string, sbUrl: string): string {
  return (
    paras.join("\n\n") +
    `\n\nBook a time: ${bookUrl}` +
    `\nJust give me sandbox access: ${sbUrl}` +
    `\n\nBest,\n\n${SIGNATURE_TEXT}`
  );
}

function firstNameOf(name: string | null | undefined, email: string): string {
  const n = (name ?? "").trim();
  if (n) return n.split(/\s+/)[0]!;
  return email.split("@")[0] || "there";
}

export interface StartInviteInput {
  email: string;
  name?: string | null;
  company?: string | null;
  hsContactId?: string | null;
  ownerId?: string | null;
  source?: string | null;
  asset?: string | null;
}

/** Create the invite row (one per email) and, if the feature is live, send the
 *  instant invite. Best-effort: never throws into the capture path. Returns
 *  whether a new invite was started (false = already invited / disabled). */
export async function startLeadInvite(db: DB, input: StartInviteInput): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  if (!email) return false;
  const token = crypto.randomBytes(24).toString("base64url");
  try {
    // One invite per lead: insert, ignore if we've invited this email before.
    const { data } = await db
      .from("lead_call_invites")
      .upsert(
        {
          email,
          hs_contact_id: input.hsContactId ?? null,
          name: input.name?.trim() || null,
          company: input.company?.trim() || null,
          owner_id: input.ownerId ?? null,
          source: input.source ?? null,
          asset: input.asset ?? null,
          token,
        },
        { onConflict: "email", ignoreDuplicates: true },
      )
      .select("id, token");
    const row = (data ?? [])[0] as { id: string; token: string } | undefined;
    if (!row) return false; // already invited this email

    if (inviteEnabled()) {
      const { subject, textBody, htmlBody } = buildInviteEmail("invite", {
        firstName: firstNameOf(input.name, email),
        company: input.company ?? null,
        asset: input.asset ?? null,
        token: row.token,
      });
      await sendTransactional({ to: email, subject, textBody, htmlBody, ownerId: input.ownerId, tag: "lead-invite" });
      await db.from("lead_call_invites").update({ invited_at: new Date().toISOString() }).eq("id", row.id);
    }
    return true;
  } catch (e) {
    console.error("startLeadInvite:", (e as Error)?.message);
    return false;
  }
}

export interface InviteRow {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  status: string;
  sandbox_opt_out_at: string | null;
}

/** Record a "just give me sandbox access" click (public link). Idempotent;
 *  returns the invite row (for the confirmation page) or null for a bad token. */
export async function recordSandboxOptOut(db: DB, token: string): Promise<InviteRow | null> {
  const { data } = await db
    .from("lead_call_invites")
    .select("id, email, name, company, status, sandbox_opt_out_at")
    .eq("token", token)
    .maybeSingle();
  const row = data as InviteRow | null;
  if (!row) return null;
  if (!row.sandbox_opt_out_at) {
    await db
      .from("lead_call_invites")
      .update({ sandbox_opt_out_at: new Date().toISOString(), status: "sandbox" })
      .eq("id", row.id);
  }
  return row;
}
