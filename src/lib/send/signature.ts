// Jim's standard email signature — the built-in DEFAULT, shared by the
// lead-invite emails (src/lib/leads/invite.ts) and the HubSpot transactional
// workflow sends (src/lib/mailer/send.ts) so every outbound mail signs off the
// same way. Keep the HTML table-based + inline-styled (email-client safe).
// This is the fallback: an operator can override it in Settings (stored in
// user_settings.email_signature_html/_text, migration 071) — see resolveSignature.

import type { serviceClient } from "../db/client";

type DB = ReturnType<typeof serviceClient>;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const SIGNATURE_HTML =
  `<br>
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Verdana,Geneva,sans-serif;font-size:14px;line-height:1.4;color:#002244;border-collapse:collapse;">
  <tbody><tr>
    <td style="width:4px;background-color:#FFD600;border-radius:2px;padding:0;"></td>
    <td style="width:16px;padding:0;"></td>
    <td style="padding:0;vertical-align:top;">
      <div style="font-size:17px;font-weight:700;color:#003566;">Jim Fell</div>
      <div style="font-size:12px;color:#4a5568;margin-top:2px;">Co-Founder &amp; CEO, <a href="https://www.creditcanary.co.uk" style="color:#003566;font-weight:700;text-decoration:none;">Credit Canary</a></div>
      <div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;font-size:12px;color:#2d3748;">
        <tbody><tr>
          <td style="padding:0 0 4px 0;width:22px;color:#003566;font-weight:700;">✉</td>
          <td style="padding:0 0 4px 0;"><a href="mailto:jim@creditcanary.co.uk" style="color:#003566;text-decoration:none;">jim@creditcanary.co.uk</a></td>
        </tr>
        <tr>
          <td style="padding:0 0 4px 0;width:22px;color:#003566;font-weight:700;">☎</td>
          <td style="padding:0 0 4px 0;"><a href="tel:+447590571361" style="color:#003566;text-decoration:none;">07590 571 361</a></td>
        </tr>
        <tr>
          <td style="padding:0 0 4px 0;width:22px;color:#003566;font-weight:700;">🌐</td>
          <td style="padding:0 0 4px 0;"><a href="https://www.creditcanary.co.uk" style="color:#003566;text-decoration:none;font-weight:700;">creditcanary.co.uk</a> &nbsp;<span style="color:#cbd5e0;">|</span>&nbsp; <a href="https://www.linkedin.com/in/jamesafell/" style="color:#003566;text-decoration:none;">LinkedIn</a></td>
        </tr>
        <tr>
          <td style="padding:0;width:22px;color:#003566;font-weight:700;">⚲</td>
          <td style="padding:0;color:#4a5568;">London, UK</td>
        </tr>
      </tbody></table>
      <div style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tbody><tr>
          <td style="background-color:#FFD600;border-radius:8px;padding:8px 16px;">
            <a href="https://meetings-eu1.hubspot.com/jim-fell" style="font-family:Verdana,Geneva,sans-serif;font-size:12px;font-weight:700;color:#003566;text-decoration:none;display:inline-block;">📅&nbsp; Book a meeting with me</a>
          </td>
        </tr>
      </tbody></table>
    </td>
  </tr>
</tbody></table>`;

export const SIGNATURE_TEXT =
  `Jim Fell\n` +
  `Co-Founder & CEO, Credit Canary\n` +
  `jim@creditcanary.co.uk · 07590 571 361\n` +
  `creditcanary.co.uk · https://www.linkedin.com/in/jamesafell/\n` +
  `Book a meeting: https://meetings-eu1.hubspot.com/jim-fell`;

/** Append the signature to an HTML body (idempotent-ish: callers pass a body
 *  that doesn't already carry it). A thin rule separates it from the message.
 *  Pass a resolved signature to use the operator's custom one; defaults to the
 *  built-in. */
export function appendSignatureHtml(bodyHtml: string, sigHtml: string = SIGNATURE_HTML): string {
  return `${bodyHtml}<div style="margin-top:20px;">${sigHtml}</div>`;
}

/** Append the signature to a plain-text body, after the message's own sign-off. */
export function appendSignatureText(bodyText: string, sigText: string = SIGNATURE_TEXT): string {
  return `${bodyText}\n\n${sigText}`;
}

/** Resolve the signature for an owner: their custom one from Settings
 *  (user_settings.email_signature_html/_text) if set, else the built-in default.
 *  Resilient — returns the default if the column/row is missing (e.g. before
 *  migration 071), so nothing breaks. */
export async function resolveSignature(db: DB, ownerId: string | null | undefined): Promise<{ html: string; text: string }> {
  if (!ownerId) return { html: SIGNATURE_HTML, text: SIGNATURE_TEXT };
  try {
    const { data } = await db
      .from("user_settings")
      .select("email_signature_html, email_signature_text")
      .eq("user_id", ownerId)
      .maybeSingle();
    return {
      html: (data?.email_signature_html ?? "").trim() || SIGNATURE_HTML,
      text: (data?.email_signature_text ?? "").trim() || SIGNATURE_TEXT,
    };
  } catch {
    return { html: SIGNATURE_HTML, text: SIGNATURE_TEXT };
  }
}

export { esc as escapeHtml };
