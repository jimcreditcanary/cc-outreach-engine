// Postmark send wrapper (build brief §8). Sends on the Broadcast stream from
// the sender's mail address, Reply-To their main address. Per-user sender
// identity comes from public.user_settings keyed by owner_id; the env vars
// (POSTMARK_FROM / POSTMARK_REPLY_TO) are workspace-wide fallbacks for
// rows without an owner. Link tracking on (clicks are a real signal);
// open tracking OFF (opens never gate anything, §6).
//
// DRY RUN: if POSTMARK_SERVER_TOKEN is unset, nothing is sent — returns a
// dryRun marker so the whole pipeline can be exercised before go-live.

import { ServerClient, Models } from "postmark";
import { serviceClient } from "../db/client";

export interface SendInput {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  tag?: string;
  /** Owner of the send — used to pick the per-user sender identity. Falls
   *  back to env defaults when null / no user_settings row. */
  ownerId?: string | null;
  /** Enable Postmark open tracking. Off by default for cold outreach
   *  (Apple/Gmail prefetch makes opens unreliable, §6) — flip on for
   *  newsletters where opens are still a useful relative metric. */
  trackOpens?: boolean;
}

export interface SendResult {
  messageId: string;
  dryRun: boolean;
}

let _client: ServerClient | null = null;

export function isDryRun(): boolean {
  return !process.env.POSTMARK_SERVER_TOKEN;
}

/** Resolve the From / Reply-To pair for a given owner. */
async function resolveSenderIdentity(ownerId: string | null | undefined): Promise<{ from: string; replyTo: string }> {
  const envFrom = process.env.POSTMARK_FROM ?? "Jim Fell <jim@mail.creditcanary.co.uk>";
  const envReply = process.env.POSTMARK_REPLY_TO ?? "jimfell@creditcanary.co.uk";
  if (!ownerId) return { from: envFrom, replyTo: envReply };
  try {
    const { data } = await serviceClient()
      .from("user_settings")
      .select("from_email, reply_to_email")
      .eq("user_id", ownerId)
      .maybeSingle();
    return {
      from: data?.from_email || envFrom,
      replyTo: data?.reply_to_email || envReply,
    };
  } catch {
    return { from: envFrom, replyTo: envReply };
  }
}

export async function sendBroadcast(input: SendInput): Promise<SendResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return { messageId: `dryrun-${Date.now()}`, dryRun: true };

  const { from, replyTo } = await resolveSenderIdentity(input.ownerId);

  if (!_client) _client = new ServerClient(token);
  const res = await _client.sendEmail({
    From: from,
    To: input.to,
    Subject: input.subject,
    HtmlBody: input.htmlBody,
    TextBody: input.textBody,
    ReplyTo: replyTo,
    MessageStream: process.env.POSTMARK_BROADCAST_STREAM ?? "outreach",
    TrackOpens: input.trackOpens ?? false,
    TrackLinks: Models.LinkTrackingOptions.HtmlOnly,
    Tag: input.tag,
  });
  return { messageId: res.MessageID, dryRun: false };
}
