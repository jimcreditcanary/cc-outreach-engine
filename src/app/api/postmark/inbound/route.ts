// Postmark inbound webhook (build brief §9): a contact replied. Match by
// sender address, mark the reply, pause cadence (the machine backs off while
// Jim handles it personally), and honour opt-out instantly.

import { serviceClient } from "@/lib/db/client";
import { authorized } from "@/lib/webhooks/guard";
import { isUnsubscribe } from "@/lib/cadence/reply";
import { snoozeUntil } from "@/lib/cadence/cadence";

// Long pause on reply — an active conversation; Jim re-activates if needed.
const REPLY_PAUSE_DAYS = 365;

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return new Response("bad request", { status: 400 });

  const db = serviceClient();
  const from = (body.FromFull?.Email ?? body.From ?? "").trim();
  const text = (body.StrippedTextReply ?? body.TextBody ?? "") as string;
  const subject = (body.Subject ?? "") as string;
  const now = new Date();

  const { data: contact } = await db
    .from("contacts")
    .select("id, organisation_id")
    .ilike("email", from)
    .maybeSingle();

  // Unmatched sender → log for manual triage, no contact link.
  if (!contact) {
    await db.from("events").insert({
      type: "reply",
      source: "postmark-inbound",
      payload: { from, subject, unmatched: true },
    });
    return Response.json({ ok: true, matched: false });
  }

  // Mark the contact's most recent sent message as replied.
  const { data: lastSend } = await db
    .from("sends")
    .select("id")
    .eq("contact_id", contact.id)
    .eq("status", "sent")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastSend) await db.from("sends").update({ replied: true }).eq("id", lastSend.id);

  await db.from("events").insert({
    contact_id: contact.id,
    organisation_id: contact.organisation_id,
    type: "reply",
    source: "postmark-inbound",
    payload: { from, subject },
  });

  if (isUnsubscribe(text)) {
    await db.from("suppressions").upsert(
      { email: from, reason: "unsubscribe", contact_id: contact.id, note: "reply opt-out" },
      { onConflict: "email" },
    );
  } else {
    // Pause cadence — active conversation.
    await db.from("contacts").update({ snooze_until: snoozeUntil(now, REPLY_PAUSE_DAYS) }).eq("id", contact.id);
  }

  return Response.json({ ok: true, matched: true });
}
