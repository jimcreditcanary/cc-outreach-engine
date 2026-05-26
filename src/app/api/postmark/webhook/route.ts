// Postmark outbound webhook (build brief §9): clicks, bounces, complaints,
// unsubscribes. Opens are acknowledged but never acted on (§6 — Apple/Gmail
// prefetch makes them noise). One Postmark event per POST, keyed by RecordType.

import { serviceClient } from "@/lib/db/client";
import { authorized } from "@/lib/webhooks/guard";

type DB = ReturnType<typeof serviceClient>;

async function contactByEmail(db: DB, email?: string) {
  if (!email) return null;
  const { data } = await db
    .from("contacts")
    .select("id, organisation_id")
    .ilike("email", email)
    .maybeSingle();
  return data ?? null;
}

async function sendByMessageId(db: DB, messageId?: string) {
  if (!messageId) return null;
  const { data } = await db
    .from("sends")
    .select("id, contact_id")
    .eq("postmark_message_id", messageId)
    .maybeSingle();
  return data ?? null;
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return new Response("bad request", { status: 400 });

  const db = serviceClient();
  const type = body.RecordType as string;
  const messageId = body.MessageID as string | undefined;
  const email = (body.Email ?? body.Recipient) as string | undefined;

  switch (type) {
    case "Click": {
      const send = await sendByMessageId(db, messageId);
      if (send) {
        await db.from("sends").update({ clicked: true }).eq("id", send.id);
        await db.from("events").insert({
          contact_id: send.contact_id,
          type: "click",
          source: "postmark",
          payload: { message_id: messageId, url: body.OriginalLink ?? null },
        });
      }
      break;
    }
    case "Bounce": {
      const contact = await contactByEmail(db, email);
      const hard = String(body.Type ?? "").toLowerCase().includes("hard") || body.TypeCode === 1;
      if (contact) {
        await db.from("contacts").update({ email_status: "bounced" }).eq("id", contact.id);
        await db.from("events").insert({
          contact_id: contact.id,
          organisation_id: contact.organisation_id,
          type: "bounce",
          source: "postmark",
          payload: { message_id: messageId, type: body.Type ?? null },
        });
      }
      if (hard && email) {
        await db.from("suppressions").upsert(
          { email, reason: "hard_bounce", contact_id: contact?.id ?? null, note: body.Type ?? null },
          { onConflict: "email" },
        );
      }
      break;
    }
    case "SpamComplaint": {
      const contact = await contactByEmail(db, email);
      await db.from("events").insert({
        contact_id: contact?.id ?? null,
        organisation_id: contact?.organisation_id ?? null,
        type: "complaint",
        source: "postmark",
        payload: { message_id: messageId },
      });
      if (email) {
        await db.from("suppressions").upsert(
          { email, reason: "complaint", contact_id: contact?.id ?? null },
          { onConflict: "email" },
        );
      }
      break;
    }
    case "SubscriptionChange": {
      if (body.SuppressSending && email) {
        const contact = await contactByEmail(db, email);
        await db.from("suppressions").upsert(
          { email, reason: "unsubscribe", contact_id: contact?.id ?? null },
          { onConflict: "email" },
        );
      }
      break;
    }
    // "Open", "Delivery", others — acknowledge, do nothing.
  }

  return Response.json({ ok: true });
}
