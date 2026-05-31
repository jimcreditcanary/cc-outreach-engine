// Send batch — shared by the CLI (`npm run send`) and the cron route
// (`/api/cron/send`). Honours warm-up ramp, daily cap, sending window,
// suppressions, and the bounce/complaint auto-pause.

import { serviceClient } from "../db/client";
import { isWithinSendingWindow } from "./window";
import { parseRamp, dailyCap, daysSince } from "./warmup";
import { shouldAutoPause } from "./autopause";
import { sendBroadcast, isDryRun } from "./postmark";

type DB = ReturnType<typeof serviceClient>;

const env = (k: string, d: string) => process.env[k] ?? d;

function startOfUkDayUtc(now: Date): string {
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `${d}T00:00:00Z`;
}

export interface SendBatchResult {
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

export async function runSendBatch(db: DB, opts: { batch?: number; force?: boolean } = {}): Promise<SendBatchResult> {
  const dry = isDryRun();
  const now = new Date();

  // 1. Auto-pause guard
  const [{ count: sentCount }, { count: complaints }, { count: bounces }] = await Promise.all([
    db.from("sends").select("*", { count: "exact", head: true }).eq("status", "sent"),
    db.from("events").select("*", { count: "exact", head: true }).eq("type", "complaint"),
    db.from("events").select("*", { count: "exact", head: true }).eq("type", "bounce"),
  ]);
  const pause = shouldAutoPause(
    { sent: sentCount ?? 0, complaints: complaints ?? 0, bounces: bounces ?? 0 },
    { complaintRate: Number(env("COMPLAINT_RATE_PAUSE_THRESHOLD", "0.003")) },
  );
  if (pause.pause) {
    return { ok: false, reason: `auto-paused: ${pause.reason}`, dry, cap: 0, sentToday: 0, attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  // 2. Sending window (skipped in dry run + force mode)
  const startH = Number(env("SEND_WINDOW_START", "09"));
  const endH = Number(env("SEND_WINDOW_END", "17"));
  if (!dry && !opts.force && !isWithinSendingWindow(now, startH, endH)) {
    return { ok: true, reason: `outside sending window (${startH}-${endH} UK, Mon-Fri)`, dry, cap: 0, sentToday: 0, attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  // 3. Daily cap
  const ramp = parseRamp(env("SEND_WARMUP_RAMP", "10,20,35,50"));
  const dayIndex = daysSince(process.env.SEND_WARMUP_START_DATE, now);
  const cap = Math.min(dailyCap(ramp, dayIndex), Number(env("SEND_DAILY_CAP", "50")));
  const { count: sentToday } = await db
    .from("sends")
    .select("*", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("ts", startOfUkDayUtc(now));
  const remaining = cap - (sentToday ?? 0);

  const batchSize = opts.batch ?? 10;
  const limit = dry ? batchSize : Math.min(remaining, batchSize);
  if (!dry && limit <= 0) {
    return { ok: true, reason: `daily cap reached (${cap})`, dry, cap, sentToday: sentToday ?? 0, attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  // 4. Approved drafts (oldest first) + suppressions
  const { data: supp } = await db.from("suppressions").select("email");
  const suppressed = new Set((supp ?? []).map((s) => String(s.email).toLowerCase()));
  const { data: drafts, error } = await db
    .from("sends")
    .select("id, subject, body_html, body_text, contact:contacts(id, full_name, email, email_status, organisation_id)")
    .eq("status", "approved")
    .order("ts", { ascending: true })
    .limit(limit);
  if (error) throw error;

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const d of drafts ?? []) {
    const c = d.contact as unknown as { id: string; full_name: string; email: string; email_status: string; organisation_id: string | null } | null;
    if (!c?.email) { skipped++; continue; }
    if (c.email_status === "bounced" || suppressed.has(c.email.toLowerCase())) {
      if (!dry) await db.from("sends").update({ status: "suppressed" }).eq("id", d.id);
      skipped++;
      continue;
    }
    if (dry) { sent++; continue; }
    try {
      const res = await sendBroadcast({
        to: c.email,
        subject: d.subject as string,
        htmlBody: d.body_html as string,
        textBody: d.body_text as string,
        tag: "outreach",
      });
      await db.from("sends").update({ status: "sent", postmark_message_id: res.messageId, ts: new Date().toISOString() }).eq("id", d.id);
      await db.from("events").insert({
        contact_id: c.id,
        organisation_id: c.organisation_id,
        type: "email_sent",
        source: "send-worker",
        payload: { send_id: d.id, subject: d.subject },
      });
      const { data: cur } = await db.from("contacts").select("total_touches").eq("id", c.id).single();
      await db.from("contacts").update({ last_touched_at: new Date().toISOString(), total_touches: (cur?.total_touches ?? 0) + 1 }).eq("id", c.id);
      sent++;
    } catch (e) {
      await db.from("sends").update({ status: "failed" }).eq("id", d.id);
      console.error(`send failed for ${c.email}: ${(e as Error).message}`);
      failed++;
    }
  }

  return { ok: true, dry, cap, sentToday: sentToday ?? 0, attempted: drafts?.length ?? 0, sent, skipped, failed };
}
