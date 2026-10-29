// HubSpot transactional Single-Send email channel. When enabled, the workflow
// mailer (src/lib/mailer/send.ts) sends approved drafts THROUGH HubSpot instead
// of Postmark, so HubSpot applies native open/click tracking and logs the send
// to the contact (and associated deal) timeline automatically.
//
// Requires (Jim's setup — see .env.example):
//   1. The Transactional Email add-on on the HubSpot portal.
//   2. A transactional email asset built in HubSpot's email tool whose SUBJECT
//      and BODY are driven by custom properties:
//        subject:  {{ custom.email_subject }}
//        body:     {{ custom.email_html }}
//      — its content id goes in HUBSPOT_TRANSACTIONAL_EMAIL_ID.
//   3. The `transactional-email` scope added to the Private App token.
//   4. The sending domain connected/verified in HubSpot (so the per-user
//      `from` address is allowed).
//   5. HS_SEND_CHANNEL=hubspot to route the workflow through this channel.
//
// Unset/misconfigured → hubspotSendEnabled() is false and the mailer keeps
// using Postmark, so nothing breaks before the add-on is live.

import { hsFetch, hubspotEnabled } from "./client";

/** Default stable single-send endpoint. Override with HUBSPOT_TRANSACTIONAL_SEND_PATH
 *  if the portal is pinned to a dated version (e.g. /marketing/transactional/2026-09/single-email/send). */
const DEFAULT_SEND_PATH = "/marketing/v3/transactional/single-email/send";

export function transactionalEmailId(): number | null {
  const raw = (process.env.HUBSPOT_TRANSACTIONAL_EMAIL_ID ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** True when the workflow should send via HubSpot: channel flag set, a template
 *  id configured, and the HubSpot token present. */
export function hubspotSendEnabled(): boolean {
  return (
    process.env.HS_SEND_CHANNEL === "hubspot" &&
    transactionalEmailId() !== null &&
    hubspotEnabled()
  );
}

export interface HsTransactionalInput {
  to: string;
  /** From header, e.g. "Jim Fell <jim@creditcanary.co.uk>". Must be a domain
   *  connected in HubSpot. */
  from: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text?: string;
  /** Idempotency key — HubSpot sends at most one email per account per sendId. */
  sendId?: string;
}

export interface HsTransactionalResult {
  messageId: string;
}

interface SingleSendResponse {
  statusId?: string;
  requestedAt?: string;
  status?: string;
  sendResult?: string;
}

/** Send one transactional email through HubSpot's Single-Send API. Throws
 *  (HubSpotError) on a non-2xx — the message names the cause (e.g. missing
 *  add-on or scope), which the caller logs against the draft. */
export async function sendHubspotTransactional(input: HsTransactionalInput): Promise<HsTransactionalResult> {
  const emailId = transactionalEmailId();
  if (emailId == null) throw new Error("HUBSPOT_TRANSACTIONAL_EMAIL_ID is not set.");

  const path = process.env.HUBSPOT_TRANSACTIONAL_SEND_PATH?.trim() || DEFAULT_SEND_PATH;
  const res = await hsFetch<SingleSendResponse>(path, {
    method: "POST",
    body: {
      emailId,
      message: {
        to: input.to,
        from: input.from,
        ...(input.replyTo ? { replyTo: [input.replyTo] } : {}),
        ...(input.sendId ? { sendId: input.sendId } : {}),
      },
      // Mapped in the HubSpot template as {{ custom.email_subject }} / {{ custom.email_html }}.
      customProperties: {
        email_subject: input.subject,
        email_html: input.html,
        ...(input.text ? { email_text: input.text } : {}),
      },
    },
  });

  return { messageId: res.statusId || input.sendId || `hs-${Date.now()}` };
}
