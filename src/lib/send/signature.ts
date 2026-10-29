// Jim's standard email signature — the single source of truth, shared by the
// lead-invite emails (src/lib/leads/invite.ts) and the HubSpot transactional
// workflow sends (src/lib/mailer/send.ts) so every outbound mail signs off the
// same way. Keep the HTML table-based + inline-styled (email-client safe).

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
 *  that doesn't already carry it). A thin rule separates it from the message. */
export function appendSignatureHtml(bodyHtml: string): string {
  return `${bodyHtml}<div style="margin-top:20px;">${SIGNATURE_HTML}</div>`;
}

/** Append the signature to a plain-text body, after the message's own sign-off. */
export function appendSignatureText(bodyText: string): string {
  return `${bodyText}\n\n${SIGNATURE_TEXT}`;
}

export { esc as escapeHtml };
