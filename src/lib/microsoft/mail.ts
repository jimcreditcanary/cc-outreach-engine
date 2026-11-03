// Send mail from the connected operator's Outlook mailbox via Microsoft Graph
// (/me/sendMail). Used by the outreach send batch when HS_SEND_CHANNEL=outlook
// — "its outreach but validated contacts I've spoken to", so it goes from Jim's
// own mailbox rather than a bulk Postmark stream. Needs the Mail.Send delegated
// scope (added to MS_SCOPES); a token granted before that scope existed 403s
// with a clear "reconnect" message.

export interface GraphMailInput {
  to: string;
  subject: string;
  html: string;
  /** Reply-To, if different from the sending mailbox. */
  replyTo?: string | null;
}

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphMailError extends Error {
  constructor(message: string, readonly status: number, readonly needsReconnect = false) {
    super(message);
    this.name = "GraphMailError";
  }
}

/** Send one message. Graph returns 202 Accepted with no id; the mail lands in
 *  the mailbox's Sent Items (saveToSentItems). Throws GraphMailError on failure
 *  — a 403 is surfaced as needsReconnect so the operator knows to re-grant
 *  Mail.Send. */
export async function sendGraphMail(accessToken: string, input: GraphMailInput): Promise<void> {
  const message: Record<string, unknown> = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients: [{ emailAddress: { address: input.to } }],
  };
  if (input.replyTo) message.replyTo = [{ emailAddress: { address: input.replyTo } }];

  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (res.status === 202 || res.ok) return;

  const text = await res.text().catch(() => "");
  // 403 (ErrorAccessDenied) usually means the token predates the Mail.Send grant.
  const needsReconnect = res.status === 403 || /mail\.send|scope|permission/i.test(text);
  throw new GraphMailError(
    `Graph sendMail failed (${res.status})${needsReconnect ? " — reconnect Outlook to grant Mail.Send" : ""}: ${text.slice(0, 300)}`,
    res.status,
    needsReconnect,
  );
}
