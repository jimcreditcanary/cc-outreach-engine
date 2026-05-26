// Shared-secret guard for Postmark webhook routes. Configure the webhook URL
// in Postmark with ?token=<POSTMARK_INBOUND_WEBHOOK_SECRET>. If no secret is
// set (local dev), requests are allowed.

export function authorized(req: Request): boolean {
  const secret = process.env.POSTMARK_INBOUND_WEBHOOK_SECRET;
  if (!secret) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}
