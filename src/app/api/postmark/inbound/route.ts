// Postmark inbound webhook (build brief §9): a contact replied. We:
//   1. Resolve the operator the reply was meant for by matching the
//      inbound To address against user_settings.reply_to_email (falls
//      back to the contact's owner_id if the To header is missing,
//      then to the workspace default operator).
//   2. Match the FROM to an existing contact by email.
//   3. Record the event with owner_id, full body, parsed signature.
//   4. Mark the most recent send replied, pause any live sequence.
//   5. Auto-patch the contact's mobile / job_title / linkedin_url from
//      the signature IF those fields are currently blank (never
//      overwrites existing data).
//   6. Honour opt-out instantly.

import { serviceClient } from "@/lib/db/client";
import { authorized } from "@/lib/webhooks/guard";
import { isUnsubscribe } from "@/lib/cadence/reply";
import { snoozeUntil } from "@/lib/cadence/cadence";
import { parseSignature } from "@/lib/inbound/signature";

const REPLY_PAUSE_DAYS = 365;

interface PostmarkAddress { Email?: string; Name?: string }
interface PostmarkInbound {
  FromFull?: PostmarkAddress;
  From?: string;
  To?: string;
  ToFull?: PostmarkAddress[];
  OriginalRecipient?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
}

/** Pull every plausible recipient address out of the inbound payload.
 *  Postmark gives To, ToFull[], and (when relayed via Exchange BCC)
 *  OriginalRecipient. We probe all three and lowercase for matching. */
function recipientAddresses(body: PostmarkInbound): string[] {
  const out = new Set<string>();
  const addOne = (raw: string | null | undefined) => {
    if (!raw) return;
    // "Name <addr@x>" or bare "addr@x"
    const m = /<([^>]+)>/.exec(raw);
    const addr = (m?.[1] ?? raw).trim().toLowerCase();
    if (addr.includes("@")) out.add(addr);
  };
  addOne(body.To);
  for (const t of body.ToFull ?? []) addOne(t?.Email);
  addOne(body.OriginalRecipient);
  return Array.from(out);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as PostmarkInbound | null;
  if (!body) return new Response("bad request", { status: 400 });

  const db = serviceClient();
  const from = (body.FromFull?.Email ?? body.From ?? "").trim().toLowerCase();
  const fromName = (body.FromFull?.Name ?? "").trim();
  const text = (body.StrippedTextReply ?? body.TextBody ?? "") as string;
  const html = (body.HtmlBody ?? "") as string;
  const subject = (body.Subject ?? "") as string;
  const recipients = recipientAddresses(body);
  const now = new Date();

  // ── Resolve owner from inbound recipient ──────────────────────────
  // Look up every operator's reply_to_email + from_email and pick the
  // first match against the recipient list.
  let owner_id: string | null = null;
  if (recipients.length > 0) {
    const { data: settings } = await db
      .from("user_settings")
      .select("user_id, reply_to_email, from_email");
    if (settings) {
      const normalised = recipients;
      for (const s of settings as { user_id: string; reply_to_email: string | null; from_email: string | null }[]) {
        const reply = (s.reply_to_email ?? "").toLowerCase();
        // from_email is usually "Name <addr>" — strip
        const fromRaw = (s.from_email ?? "").toLowerCase();
        const fromMatch = /<([^>]+)>/.exec(fromRaw)?.[1] ?? fromRaw;
        if (reply && normalised.includes(reply)) { owner_id = s.user_id; break; }
        if (fromMatch && normalised.includes(fromMatch)) { owner_id = s.user_id; break; }
      }
    }
  }

  // Parse signature once — we use it for the auto-patch + cache it in payload.
  const sig = parseSignature(text || html);

  // ── Match sender to contact ───────────────────────────────────────
  const { data: contact } = await db
    .from("contacts")
    .select("id, organisation_id, owner_id, mobile, job_title, linkedin_url")
    .ilike("email", from)
    .maybeSingle();

  // If we couldn't pin the owner from the recipient, fall back to the
  // matched contact's owner_id (so at least it goes to the right inbox
  // when the To header is clean).
  if (!owner_id && contact?.owner_id) owner_id = contact.owner_id;

  const basePayload = {
    from,
    from_name: fromName || null,
    subject,
    text_body: text,
    html_body: html,
    to: recipients,
    signature_parsed: sig,
  };

  // ── Unmatched sender path ─────────────────────────────────────────
  if (!contact) {
    await db.from("events").insert({
      type: "reply",
      source: "postmark-inbound",
      owner_id,
      payload: { ...basePayload, unmatched: true },
    });
    return Response.json({ ok: true, matched: false });
  }

  // ── Auto-patch contact from signature (never overwrite) ──────────
  const patch: { mobile?: string; job_title?: string; linkedin_url?: string } = {};
  if (sig.mobile && !contact.mobile) patch.mobile = sig.mobile;
  if (sig.job_title && !contact.job_title) patch.job_title = sig.job_title;
  if (sig.linkedin_url && !contact.linkedin_url) patch.linkedin_url = sig.linkedin_url;
  if (Object.keys(patch).length > 0) {
    await db.from("contacts").update(patch).eq("id", contact.id);
  }

  // ── Mark most recent send replied + pause sequence ────────────────
  const { data: lastSend } = await db
    .from("sends")
    .select("id, sequence_id")
    .eq("contact_id", contact.id)
    .eq("status", "sent")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastSend) await db.from("sends").update({ replied: true }).eq("id", lastSend.id);
  if (lastSend?.sequence_id) {
    await db.from("sequence_contacts")
      .update({ status: "replied" })
      .eq("sequence_id", lastSend.sequence_id)
      .eq("contact_id", contact.id);
  }

  await db.from("events").insert({
    contact_id: contact.id,
    organisation_id: contact.organisation_id,
    type: "reply",
    source: "postmark-inbound",
    owner_id,
    payload: { ...basePayload, patched: Object.keys(patch) },
  });

  if (isUnsubscribe(text)) {
    await db.from("suppressions").upsert(
      { email: from, reason: "unsubscribe", contact_id: contact.id, note: "reply opt-out" },
      { onConflict: "email" },
    );
  } else {
    await db.from("contacts").update({ snooze_until: snoozeUntil(now, REPLY_PAUSE_DAYS) }).eq("id", contact.id);
  }

  return Response.json({ ok: true, matched: true, owner_id, patched: Object.keys(patch) });
}
