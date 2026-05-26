// Postmark send wrapper (build brief §8). Sends on the Broadcast stream from
// Jim's mail subdomain, Reply-To his main address. Link tracking on (clicks
// are a real signal); open tracking OFF (opens never gate anything, §6).
//
// DRY RUN: if POSTMARK_SERVER_TOKEN is unset, nothing is sent — returns a
// dryRun marker so the whole pipeline can be exercised before go-live.

import { ServerClient, Models } from "postmark";

export interface SendInput {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  tag?: string;
}

export interface SendResult {
  messageId: string;
  dryRun: boolean;
}

let _client: ServerClient | null = null;

export function isDryRun(): boolean {
  return !process.env.POSTMARK_SERVER_TOKEN;
}

export async function sendBroadcast(input: SendInput): Promise<SendResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return { messageId: `dryrun-${Date.now()}`, dryRun: true };

  if (!_client) _client = new ServerClient(token);
  const res = await _client.sendEmail({
    From: process.env.POSTMARK_FROM ?? "Jim Fell <jim@mail.creditcanary.co.uk>",
    To: input.to,
    Subject: input.subject,
    HtmlBody: input.htmlBody,
    TextBody: input.textBody,
    ReplyTo: process.env.POSTMARK_REPLY_TO ?? "jimfell@creditcanary.co.uk",
    MessageStream: process.env.POSTMARK_BROADCAST_STREAM ?? "outreach",
    TrackOpens: false,
    TrackLinks: Models.LinkTrackingOptions.HtmlOnly,
    Tag: input.tag,
  });
  return { messageId: res.MessageID, dryRun: false };
}
