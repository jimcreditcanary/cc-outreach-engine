// Send worker (build brief §8/§11): drains approved drafts, respecting the
// warm-up ramp, the daily cap, the UK sending window, suppressions, and the
// complaint/bounce auto-pause. Meant to run on a schedule (small batches).
//
//   npm run send                 send up to a batch within all guardrails
//   npm run send -- 10           cap this run to 10
//   npm run send -- 10 --force   ignore the sending-window check
//
// DRY RUN (no POSTMARK_SERVER_TOKEN): previews what WOULD send and mutates
// nothing — safe to run before go-live.

import { config } from "dotenv";
import { serviceClient } from "../src/lib/db/client";
import { isWithinSendingWindow } from "../src/lib/send/window";
import { parseRamp, dailyCap, daysSince } from "../src/lib/send/warmup";
import { shouldAutoPause } from "../src/lib/send/autopause";
import { sendBroadcast, isDryRun } from "../src/lib/send/postmark";

config({ path: ".env.local", override: true });

const env = (k: string, d: string) => process.env[k] ?? d;

function startOfUkDayUtc(now: Date): string {
  // UK calendar date (YYYY-MM-DD); UTC-midnight of it is a good-enough day
  // boundary for a soft warm-up cap.
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `${d}T00:00:00Z`;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const batchArg = args.find((a) => /^\d+$/.test(a));
  const dry = isDryRun();
  const db = serviceClient();
  const now = new Date();

  // 1. Auto-pause guard.
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
    console.error(`AUTO-PAUSED: ${pause.reason}. No sends.`);
    process.exit(1);
  }

  // 2. Sending window (skipped in dry run so you can always preview).
  const startH = Number(env("SEND_WINDOW_START", "09"));
  const endH = Number(env("SEND_WINDOW_END", "17"));
  if (!dry && !force && !isWithinSendingWindow(now, startH, endH)) {
    console.log(`Outside the UK sending window (${startH}:00–${endH}:00, Mon–Fri). Nothing sent.`);
    return;
  }

  // 3. Daily cap = min(warm-up ramp for today, absolute cap) − already sent today.
  const ramp = parseRamp(env("SEND_WARMUP_RAMP", "10,20,35,50"));
  const dayIndex = daysSince(process.env.SEND_WARMUP_START_DATE, now);
  const cap = Math.min(dailyCap(ramp, dayIndex), Number(env("SEND_DAILY_CAP", "50")));
  const { count: sentToday } = await db
    .from("sends")
    .select("*", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("ts", startOfUkDayUtc(now));
  const remaining = cap - (sentToday ?? 0);

  const batchSize = batchArg ? Number(batchArg) : 10;
  const limit = dry ? batchSize : Math.min(remaining, batchSize);
  if (!dry && limit <= 0) {
    console.log(`Daily cap reached (cap ${cap}, sent today ${sentToday ?? 0}). Nothing sent.`);
    return;
  }

  // 4. Suppression set + approved drafts (oldest first).
  const { data: supp } = await db.from("suppressions").select("email");
  const suppressed = new Set((supp ?? []).map((s) => String(s.email).toLowerCase()));

  const { data: drafts, error } = await db
    .from("sends")
    .select("id, subject, body_html, body_text, contact:contacts(id, full_name, email, email_status, organisation_id)")
    .eq("status", "approved")
    .order("ts", { ascending: true })
    .limit(limit);
  if (error) throw error;

  console.log(
    `${dry ? "[DRY RUN] " : ""}cap ${cap} (day ${dayIndex}), sent today ${sentToday ?? 0}, draining up to ${limit}; ${drafts?.length ?? 0} approved.`,
  );

  let sent = 0;
  let skipped = 0;
  for (const d of drafts ?? []) {
    const c = d.contact as unknown as {
      id: string;
      full_name: string;
      email: string;
      email_status: string;
      organisation_id: string | null;
    } | null;
    if (!c?.email) {
      skipped++;
      continue;
    }
    if (c.email_status === "bounced" || suppressed.has(c.email.toLowerCase())) {
      if (!dry) await db.from("sends").update({ status: "suppressed" }).eq("id", d.id);
      console.log(`  skip (suppressed/bounced): ${c.email}`);
      skipped++;
      continue;
    }

    if (dry) {
      console.log(`  [would send] ${c.full_name} <${c.email}> — "${d.subject}"`);
      sent++;
      continue;
    }

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
      // Bump touch counters (read-then-write; single worker, no race).
      const { data: cur } = await db.from("contacts").select("total_touches").eq("id", c.id).single();
      await db
        .from("contacts")
        .update({ last_touched_at: new Date().toISOString(), total_touches: (cur?.total_touches ?? 0) + 1 })
        .eq("id", c.id);
      console.log(`  sent → ${c.email} (${res.messageId})`);
      sent++;
    } catch (e) {
      await db.from("sends").update({ status: "failed" }).eq("id", d.id);
      console.error(`  FAILED → ${c.email}: ${(e as Error).message}`);
      skipped++;
    }
  }

  console.log(`${dry ? "[DRY RUN] " : ""}${sent} ${dry ? "previewed" : "sent"}, ${skipped} skipped.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
