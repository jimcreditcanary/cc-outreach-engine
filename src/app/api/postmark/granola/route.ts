// Postmark inbound webhook for Granola "share via email" forwards.
//
// Flow:
//   1. Postmark POSTs the inbound email here when its To matches the
//      Granola-forward address you configured (CRON_SECRET guards).
//   2. Resolve which operator forwarded by matching From / Reply-To
//      against user_settings.reply_to_email / from_email and
//      auth.users.email.
//   3. Parse the email body for transcript + summary + meeting title.
//   4. Find that operator's meeting whose subject best matches the
//      title, within ±3 days of now (forwards usually come in within
//      hours of the meeting).
//   5. Hand to applyTranscriptToMeeting which writes the transcript,
//      runs post-summary, drafts the follow-up, ships it.
//
// Returns a JSON summary including the matched meeting id so Postmark's
// activity log shows what happened.

import { serviceClient } from "@/lib/db/client";
import { authorized } from "@/lib/webhooks/guard";
import { parseGranolaEmail } from "@/lib/granola/parseEmail";
import { applyTranscriptToMeeting } from "@/lib/granola/applyTranscript";

export const maxDuration = 120;

interface PostmarkInbound {
  FromFull?: { Email?: string };
  From?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
}

/** Fuzzy match score [0..1] between two strings. Token-overlap based;
 *  cheap + good-enough for meeting titles (avoids pulling in a fuzz lib). */
function titleSimilarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const ta = tok(a);
  const tb = tok(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as PostmarkInbound | null;
  if (!body) return new Response("bad request", { status: 400 });

  const db = serviceClient();
  const fromAddr = (body.FromFull?.Email ?? body.From ?? "").trim().toLowerCase();
  const subject = (body.Subject ?? "").trim();
  const textBody = (body.TextBody ?? body.StrippedTextReply ?? "") as string;

  // ── Identify the forwarding operator ─────────────────────────────
  let ownerId: string | null = null;
  if (fromAddr) {
    const { data: settings } = await db
      .from("user_settings")
      .select("user_id, reply_to_email, from_email");
    for (const s of (settings ?? []) as { user_id: string; reply_to_email: string | null; from_email: string | null }[]) {
      const reply = (s.reply_to_email ?? "").toLowerCase();
      const fromRaw = (s.from_email ?? "").toLowerCase();
      const fromAddrMatch = /<([^>]+)>/.exec(fromRaw)?.[1] ?? fromRaw;
      if (reply === fromAddr || fromAddrMatch === fromAddr) {
        ownerId = s.user_id;
        break;
      }
    }
    if (!ownerId) {
      // Fall back to auth.users.email — the operator may not have a
      // user_settings row populated yet.
      const { adminClient } = await import("@/lib/auth/admin");
      const { data: usersRes } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 100 });
      const match = usersRes?.users.find((u) => (u.email ?? "").toLowerCase() === fromAddr);
      if (match) ownerId = match.id;
    }
  }
  if (!ownerId) {
    return Response.json({
      ok: false,
      error: "Could not identify a CRM operator from From address",
      from: fromAddr,
    }, { status: 422 });
  }

  // ── Parse the email body ─────────────────────────────────────────
  const parsed = parseGranolaEmail({ subject, text_body: textBody, html_body: body.HtmlBody ?? null });
  if (!parsed.transcript && !parsed.granola_summary) {
    return Response.json({
      ok: false,
      error: "No transcript or summary found in email body — couldn't parse",
      parsed_title: parsed.meeting_title,
    }, { status: 422 });
  }

  // ── Find the matching meeting ────────────────────────────────────
  // Search the operator's sales-relevant meetings in a wide ±3-day
  // window. Forwarded notes usually come in within hours of the call.
  const windowStart = parsed.meeting_started_at
    ? new Date(new Date(parsed.meeting_started_at).getTime() - 3 * 86_400_000).toISOString()
    : new Date(Date.now() - 3 * 86_400_000).toISOString();
  const windowEnd = parsed.meeting_started_at
    ? new Date(new Date(parsed.meeting_started_at).getTime() + 3 * 86_400_000).toISOString()
    : new Date(Date.now() + 1 * 86_400_000).toISOString();

  const { data: meetings } = await db
    .from("meetings")
    .select(`
      id, subject, start_at, transcript, brief, owner_id, organisation_id,
      granola_followup_send_id,
      organisation:organisations(name),
      primary_contact:contacts(id, full_name, email),
      deal:deals(title, stage)
    `)
    .eq("owner_id", ownerId)
    .eq("sales_relevant", true)
    .gte("start_at", windowStart)
    .lte("start_at", windowEnd)
    .limit(50);
  const candidates = meetings ?? [];
  if (candidates.length === 0) {
    return Response.json({
      ok: false,
      error: "No sales-relevant meeting in the ±3-day window for this operator",
      parsed_title: parsed.meeting_title,
      window: { windowStart, windowEnd },
    }, { status: 422 });
  }

  // Rank by title similarity; prefer closest start_time on a tie.
  const scored = candidates.map((m) => ({
    meeting: m,
    score: titleSimilarity(m.subject ?? "", parsed.meeting_title),
    dtMs: parsed.meeting_started_at
      ? Math.abs(new Date(m.start_at as string).getTime() - new Date(parsed.meeting_started_at).getTime())
      : Number.MAX_SAFE_INTEGER,
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.dtMs - b.dtMs));
  const best = scored[0]!;
  // Require some semantic overlap — < 0.2 is "couldn't find a match worth trusting".
  if (best.score < 0.2 && parsed.meeting_started_at === null) {
    return Response.json({
      ok: false,
      error: "No meeting title overlapped strongly enough with the email subject",
      parsed_title: parsed.meeting_title,
      candidates: candidates.map((c) => ({ id: c.id, subject: c.subject, score: titleSimilarity(c.subject ?? "", parsed.meeting_title) })),
    }, { status: 422 });
  }

  // ── Apply: write transcript + post-summary + follow-up email ─────
  const applied = await applyTranscriptToMeeting(
    db,
    best.meeting as Parameters<typeof applyTranscriptToMeeting>[1],
    {
      transcript: parsed.transcript || parsed.granola_summary || "",
      granolaSummary: parsed.granola_summary,
      granolaNoteId: null, // email-forward has no Granola note id
      source: "granola-email",
    },
  );

  return Response.json({
    ok: true,
    matched_meeting_id: best.meeting.id,
    matched_title: best.meeting.subject,
    score: best.score,
    parsed_title: parsed.meeting_title,
    applied,
  });
}
