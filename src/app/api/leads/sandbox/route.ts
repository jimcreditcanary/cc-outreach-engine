// GET /api/leads/sandbox?token=... — the "just give me sandbox access" link in
// the lead invite email. Records the opt-out (stops the chase sequence) and
// alerts Jim to set the lead up with sandbox access. Public (under the /api/leads
// prefix); the token is the only credential and maps to one lead invite.
//
// There's no self-serve sandbox provisioning yet, so this flags the request for
// Jim rather than granting access automatically (that comes with the proposals
// work later).

import { serviceClient } from "@/lib/db/client";
import { recordSandboxOptOut } from "@/lib/leads/invite";
import { resolveInboundOwner } from "@/lib/leads/capture";
import { sendTransactional } from "@/lib/send/postmark";

export const dynamic = "force-dynamic";

function page(title: string, message: string): Response {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title} · Credit Canary</title></head>` +
    `<body style="margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f4f6fa;color:#1a1a1a;">` +
    `<div style="max-width:520px;margin:12vh auto;padding:32px 24px;background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(11,31,58,.08);">` +
    `<h1 style="margin:0 0 12px;font-size:20px;color:#0B1F3A;">${title}</h1>` +
    `<p style="margin:0;font-size:15px;line-height:1.55;color:#333;">${message}</p>` +
    `</div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return page("Link not recognised", "This link looks incomplete. Just reply to Jim's email and he'll sort you out.");

  const db = serviceClient();
  const invite = await recordSandboxOptOut(db, token);
  if (!invite) return page("Link not recognised", "We couldn't match this link. Just reply to Jim's email and he'll set you up.");

  // Alert Jim once (first opt-out only).
  if (!invite.sandbox_opt_out_at) {
    try {
      const { ownerId, notifyEmail } = await resolveInboundOwner(db);
      const who = invite.name || invite.email;
      const lines = [
        `${who}${invite.company ? ` (${invite.company})` : ""} would rather skip the call and just get sandbox access.`,
        ``,
        `Email: ${invite.email}`,
        invite.company ? `Company: ${invite.company}` : "",
        ``,
        `Set them up with sandbox access.`,
      ].filter((l) => l !== undefined);
      await sendTransactional({
        to: notifyEmail,
        subject: `Sandbox request — ${who}`,
        textBody: lines.join("\n"),
        htmlBody: lines.map((l) => (l ? `<p style="margin:0 0 8px;">${l}</p>` : "")).join(""),
        ownerId,
        tag: "lead-sandbox-request",
      }).catch(() => {});
    } catch { /* alert is best-effort; the opt-out is already recorded */ }
  }

  return page(
    "You're all set",
    "Thanks — no call needed. Jim will set you up with sandbox access shortly and email you the details. If you'd still like to talk anything through, just reply to his email.",
  );
}
