// Shared ops alerting for the HubSpot mirror (failed runs + the staleness
// watchdog). Sends to OPS_ALERT_EMAIL, falling back to the lead-alert inbox.

import { sendTransactional } from "../send/postmark";

export function opsAlertRecipient(): string {
  return (
    process.env.OPS_ALERT_EMAIL ??
    process.env.INBOUND_LEAD_EMAIL ??
    process.env.POSTMARK_REPLY_TO ??
    "jim@creditcanary.co.uk"
  );
}

export async function sendMirrorAlert(subject: string, bodyLines: string[]): Promise<void> {
  await sendTransactional({
    to: opsAlertRecipient(),
    subject,
    textBody: bodyLines.join("\n"),
    htmlBody: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px">${bodyLines
      .map((l) => (l ? `<p style="margin:4px 0">${l}</p>` : ""))
      .join("")}</div>`,
    tag: "ops-mirror",
  }).catch(() => {});
}
