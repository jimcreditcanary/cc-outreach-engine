// HubSpot mailer send runner — sends APPROVED hs_sends via Postmark, with the
// same guardrails as the Supabase mailer (reused pure helpers): bounce/
// complaint auto-pause, UK business-hours window, warm-up ramp + daily cap,
// email-keyed suppression. On send it logs to hs_sends and mirrors a Note to
// the HubSpot contact timeline (best-effort). Dry-run when POSTMARK token unset.

import { serviceClient } from "../db/client";
import { isWithinSendingWindow } from "../send/window";
import { parseRamp, dailyCap, daysSince } from "../send/warmup";
import { shouldAutoPause } from "../send/autopause";
import { sendBroadcast, isDryRun } from "../send/postmark";
import { addContactNote } from "../hubspot/repo";

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

interface DraftRow {
  id: string;
  hs_contact_id: string;
  email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  owner_id: string | null;
  campaign: string | null;
}

export async function runHsSendBatch(db: DB, opts: { batch?: number; force?: boolean } = {}): Promise<HsSendBatchResult> {
  const dry = isDryRun();
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

  // 4. Approved rows (oldest first) + suppressions.
  const { data: supp } = await db.from("suppressions").select("email");
  const suppressed = new Set((supp ?? []).map((s) => String((s as { email: string }).email).toLowerCase()));
  const { data: drafts, error } = await db
    .from("hs_sends")
    .select("id, hs_contact_id, email, subject, body_html, body_text, owner_id, campaign")
    .eq("status", "approved")
    .order("ts", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const rows = (drafts ?? []) as unknown as DraftRow[];

  let sent = 0, skipped = 0, failed = 0;
  for (const d of rows) {
    const email = String(d.email).toLowerCase();
    if (suppressed.has(email)) {
      if (!dry) await db.from("hs_sends").update({ status: "suppressed" }).eq("id", d.id);
      skipped++;
      continue;
    }
    if (dry) { sent++; continue; }
    try {
      const res = await sendBroadcast({
        to: d.email,
        subject: d.subject ?? "",
        htmlBody: d.body_html ?? "",
        textBody: d.body_text ?? "",
        tag: `hs-${d.campaign ?? "campaign"}`,
        ownerId: d.owner_id ?? null,
      });
      await db.from("hs_sends").update({ status: "sent", postmark_message_id: res.messageId, sent_at: new Date().toISOString() }).eq("id", d.id);
      // Mirror to the HubSpot contact timeline (best-effort — needs notes scope).
      await addContactNote(d.hs_contact_id, `✉️ Outreach sent${d.campaign ? ` (${d.campaign})` : ""}: ${d.subject ?? ""}`);
      sent++;
    } catch (e) {
      await db.from("hs_sends").update({ status: "failed", error: String((e as Error)?.message ?? e) }).eq("id", d.id);
      failed++;
    }
  }

  return { ok: true, dry, cap, sentToday: sentToday ?? 0, attempted: rows.length, sent, skipped, failed };
}
