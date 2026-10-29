// HubSpot mailer send runner — sends APPROVED hs_sends, with the same guardrails
// as the Supabase mailer (reused pure helpers): bounce/complaint auto-pause, UK
// business-hours window, warm-up ramp + daily cap, email-keyed suppression.
//
// Two send channels (HS_SEND_CHANNEL):
//   • postmark (default) — send via Postmark, then mirror an email activity to
//     the HubSpot timeline (best-effort). Dry-run when POSTMARK token unset.
//   • hubspot — send THROUGH HubSpot's transactional Single-Send API so HubSpot
//     applies native open/click tracking and logs the send to the timeline
//     itself. Always live (no dry-run).
// Both channels sign off with Jim's signature (src/lib/send/signature.ts).

import { serviceClient } from "../db/client";
import { isWithinSendingWindow } from "../send/window";
import { parseRamp, dailyCap, daysSince } from "../send/warmup";
import { shouldAutoPause } from "../send/autopause";
import { sendBroadcast, isDryRun, resolveSenderIdentity } from "../send/postmark";
import { appendSignatureHtml, appendSignatureText } from "../send/signature";
import { logEmailActivity } from "../hubspot/repo";
import { hubspotSendEnabled, sendHubspotTransactional } from "../hubspot/transactional";
import { tagLinks } from "./tracking";

type DB = ReturnType<typeof serviceClient>;
const env = (k: string, d: string) => process.env[k] ?? d;

function startOfUkDayUtc(now: Date): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `${d}T00:00:00Z`;
}

export interface HsSendBatchResult {
  ok: boolean;
  reason?: string;
  dry: boolean;
  cap: number;
  sentToday: number;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface DraftMeta { company_id?: string | null; company_name?: string | null }
interface DraftRow {
  id: string;
  hs_contact_id: string;
  email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  owner_id: string | null;
  campaign: string | null;
  meta: DraftMeta | null;
}

/** Stable per-company key so we can spread sends across companies. Falls back
 *  to company name, then to the contact id (so a company-less draft is never
 *  blocked by the cap — it's its own "company"). */
function companyKey(meta: DraftMeta | null, contactId: string): string {
  const m = meta ?? {};
  if (m.company_id) return `co:${m.company_id}`;
  if (m.company_name) return `cn:${m.company_name.toLowerCase().trim()}`;
  return `ct:${contactId}`;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export async function runHsSendBatch(db: DB, opts: { batch?: number; force?: boolean } = {}): Promise<HsSendBatchResult> {
  const channel: "hubspot" | "postmark" = hubspotSendEnabled() ? "hubspot" : "postmark";
  // HubSpot sends are always live when the channel is on; Postmark keeps its
  // token-gated dry-run (no token = simulate the whole pipeline, mutate nothing).
  const dry = channel === "postmark" ? isDryRun() : false;
  const now = new Date();
  const nil: HsSendBatchResult = { ok: true, dry, cap: 0, sentToday: 0, attempted: 0, sent: 0, skipped: 0, failed: 0 };

  // 1. Auto-pause (complaint/bounce) over the HubSpot send history.
  const [{ count: sentCount }, { count: bouncedCount }, { count: complaints }] = await Promise.all([
    db.from("hs_sends").select("*", { count: "exact", head: true }).eq("status", "sent"),
    db.from("hs_sends").select("*", { count: "exact", head: true }).eq("bounced", true),
    db.from("events").select("*", { count: "exact", head: true }).eq("type", "complaint"),
  ]);
  const pause = shouldAutoPause(
    { sent: sentCount ?? 0, complaints: complaints ?? 0, bounces: bouncedCount ?? 0 },
    { complaintRate: Number(env("COMPLAINT_RATE_PAUSE_THRESHOLD", "0.003")) },
  );
  if (pause.pause) return { ...nil, ok: false, reason: `auto-paused: ${pause.reason}` };

  // 2. Sending window (skipped in dry run / force).
  const startH = Number(env("SEND_WINDOW_START", "09"));
  const endH = Number(env("SEND_WINDOW_END", "17"));
  if (!dry && !opts.force && !isWithinSendingWindow(now, startH, endH)) {
    return { ...nil, reason: `outside sending window (${startH}-${endH} UK, Mon-Fri)` };
  }

  // 3. Warm-up ramp + daily cap.
  const ramp = parseRamp(env("SEND_WARMUP_RAMP", "10,20,35,50"));
  const dayIndex = daysSince(process.env.SEND_WARMUP_START_DATE, now);
  const cap = Math.min(dailyCap(ramp, dayIndex), Number(env("SEND_DAILY_CAP", "50")));
  const { count: sentToday } = await db.from("hs_sends").select("*", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", startOfUkDayUtc(now));
  const remaining = cap - (sentToday ?? 0);
  const batchSize = opts.batch ?? 10;
  const limit = dry ? batchSize : Math.min(remaining, batchSize);
  if (!dry && limit <= 0) return { ...nil, cap, sentToday: sentToday ?? 0, reason: `daily cap reached (${cap})` };

  // 4. Build the batch. Pull a POOL of approved drafts (not just `limit`),
  //    then select so we never send to the same company more than
  //    SEND_COMPANY_DAILY_CAP times per day — counting companies already sent
  //    to today — and shuffle so order isn't biased by company or age. Leftover
  //    same-company drafts stay approved and go out on following days.
  const { data: supp } = await db.from("suppressions").select("email");
  const suppressed = new Set((supp ?? []).map((s) => String((s as { email: string }).email).toLowerCase()));
  const companyCap = Math.max(1, Number(env("SEND_COMPANY_DAILY_CAP", "1")));

  // Companies already emailed today (so a second rep/run can't double up).
  const { data: sentTodayRows } = await db
    .from("hs_sends")
    .select("hs_contact_id, meta")
    .eq("status", "sent")
    .gte("sent_at", startOfUkDayUtc(now));
  const usedByCompany = new Map<string, number>();
  for (const s of (sentTodayRows ?? []) as unknown as { hs_contact_id: string; meta: DraftMeta | null }[]) {
    const k = companyKey(s.meta, s.hs_contact_id);
    usedByCompany.set(k, (usedByCompany.get(k) ?? 0) + 1);
  }

  const poolSize = Math.min(Math.max(limit * 10, 100), 500);
  const { data: drafts, error } = await db
    .from("hs_sends")
    .select("id, hs_contact_id, email, subject, body_html, body_text, owner_id, campaign, meta")
    .eq("status", "approved")
    .order("ts", { ascending: true })
    .limit(poolSize);
  if (error) throw error;
  const pool = shuffle((drafts ?? []) as unknown as DraftRow[]);

  let sent = 0, skipped = 0, failed = 0;

  // Selection: mark suppressed, cap per company, take up to `limit`. A deferred
  // same-company draft simply stays approved for a later day.
  const batch: DraftRow[] = [];
  for (const d of pool) {
    if (batch.length >= limit) break;
    const email = String(d.email).toLowerCase();
    if (suppressed.has(email)) {
      if (!dry) await db.from("hs_sends").update({ status: "suppressed" }).eq("id", d.id);
      skipped++;
      continue;
    }
    const key = companyKey(d.meta, d.hs_contact_id);
    if ((usedByCompany.get(key) ?? 0) >= companyCap) continue; // another contact at this company already going today
    usedByCompany.set(key, (usedByCompany.get(key) ?? 0) + 1);
    batch.push(d);
  }

  for (const d of batch) {
    if (dry) { sent++; continue; }
    // Tag CC links with UTM + per-contact id for GA4 attribution (both channels;
    // HubSpot additionally wraps links for its own click tracking), then sign
    // off with Jim's signature. Tag only the body's links — leave the
    // signature's own links clean.
    const tagOpts = { cid: d.hs_contact_id, campaign: d.campaign ?? undefined };
    const html = appendSignatureHtml(tagLinks(d.body_html ?? "", tagOpts));
    const text = appendSignatureText(tagLinks(d.body_text ?? "", tagOpts));
    try {
      if (channel === "hubspot") {
        // Send THROUGH HubSpot (Single-Send) → native open/click tracking +
        // timeline logging. From = the owner's assigned address; sign off with
        // Jim's signature. sendId = the draft id (HubSpot de-dupes retries).
        const { from, replyTo } = await resolveSenderIdentity(d.owner_id);
        const res = await sendHubspotTransactional({
          to: d.email,
          from,
          replyTo,
          subject: d.subject ?? "",
          html,
          text,
          sendId: d.id,
        });
        await db.from("hs_sends").update({ status: "sent", postmark_message_id: `hs:${res.messageId}`, sent_at: new Date().toISOString() }).eq("id", d.id);
        // HubSpot logs the transactional send to the timeline itself — no
        // separate email-activity write (that would double it up).
      } else {
        const res = await sendBroadcast({
          to: d.email,
          subject: d.subject ?? "",
          htmlBody: html,
          textBody: text,
          tag: `hs-${d.campaign ?? "campaign"}`,
          ownerId: d.owner_id ?? null,
        });
        await db.from("hs_sends").update({ status: "sent", postmark_message_id: res.messageId, sent_at: new Date().toISOString() }).eq("id", d.id);
        // Log as a HubSpot email activity (best-effort) so the send shows on the
        // contact timeline and feeds "last contacted" / deal engagement.
        await logEmailActivity(d.hs_contact_id, { subject: d.subject ?? "", text: d.body_text ?? "" });
      }
      sent++;
    } catch (e) {
      await db.from("hs_sends").update({ status: "failed", error: String((e as Error)?.message ?? e) }).eq("id", d.id);
      failed++;
    }
  }

  return { ok: true, dry, cap, sentToday: sentToday ?? 0, attempted: batch.length, sent, skipped, failed };
}
