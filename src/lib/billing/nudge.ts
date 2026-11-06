// Notice nudge (L5, DAILY cron). Emails the deal owner on the two key days
// relative to renewal_decision_date (the date notice must be given by to avoid
// auto-renewal): 30 days before, and on the day itself. Keyed to the generated
// renewal_decision_date (migration 074); for accounts predating it, falls back
// to (contract_end_date − notice_period_days). Running daily with exact-day
// matching means at most two emails per renewal, never a repeat.

import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/auth/admin";
import { sendTransactional } from "@/lib/send/postmark";
import { appendSignatureHtml, appendSignatureText } from "@/lib/send/signature";
import { londonToday } from "./clock";

type DB = SupabaseClient;

const DAY = 86_400_000;
const NUDGE_DAYS_BEFORE = [30, 0] as const; // fire 30 days out, then on the day
function appUrl(): string { return (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk").replace(/\/$/, ""); }
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / DAY);
}
function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

interface NudgeAccount { id: string; contract_end_date: string | null; notice_period_days: number | null; renewal_decision_date?: string | null; deal_owner_user_id: string | null; hubspot_company_id: string | null }

export interface NudgeSummary { nudged: number; errors: { account_id: string; error: string }[] }

export async function runNoticeNudge(db: DB, today = londonToday(), opts: { dryRun?: boolean } = {}): Promise<NudgeSummary> {
  const { dryRun = false } = opts;
  const summary: NudgeSummary = { nudged: 0, errors: [] };
  // Resilient select: renewal_decision_date exists from migration 074 onward.
  const cols = "id, contract_end_date, notice_period_days, renewal_decision_date, deal_owner_user_id, hubspot_company_id";
  let r = await db.from("billing_accounts").select(cols).in("status", ["active", "notice_given"]);
  if (r.error && /does not exist|column/i.test(r.error.message)) {
    r = await db.from("billing_accounts").select("id, contract_end_date, notice_period_days, deal_owner_user_id, hubspot_company_id").in("status", ["active", "notice_given"]) as typeof r;
  }

  for (const a of (r.data ?? []) as NudgeAccount[]) {
    // The date notice must be given by. Prefer the generated field; fall back to
    // the legacy days-before-end for accounts predating migration 074.
    const deadline = a.renewal_decision_date
      ?? (a.contract_end_date && a.notice_period_days != null ? shiftDays(a.contract_end_date, -a.notice_period_days) : null);
    if (!deadline) continue;
    const d = daysBetween(today, deadline);
    if (!NUDGE_DAYS_BEFORE.includes(d as 30 | 0)) continue;
    const when = d === 0 ? "today" : `in ${d} days (${deadline})`;
    const reasons = [`Notice to avoid auto-renewal is due ${when}. Give notice before ${deadline} or the contract renews.`];

    try {
      if (!a.deal_owner_user_id) { summary.errors.push({ account_id: a.id, error: "no deal owner" }); continue; }
      const { data } = await adminClient().auth.admin.getUserById(a.deal_owner_user_id);
      const to = data?.user?.email;
      if (!to) { summary.errors.push({ account_id: a.id, error: "no owner email" }); continue; }
      if (dryRun) { summary.nudged += 1; continue; }
      const link = `${appUrl()}/billing/${a.id}`;
      const body = [`Heads-up on ${a.hubspot_company_id ?? "a billing account"}:`, "", ...reasons.map((r) => `• ${r}`), "", `Account: ${link}`].join("\n");
      await sendTransactional({
        to, subject: `Billing: contract action coming up for ${a.hubspot_company_id ?? a.id.slice(0, 8)}`,
        textBody: appendSignatureText(body),
        htmlBody: appendSignatureHtml(`<p>Heads-up on ${a.hubspot_company_id ?? "a billing account"}:</p><ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul><p><a href="${link}">Open the account</a>.</p>`),
        tag: "billing-notice-nudge",
      });
      summary.nudged += 1;
    } catch (e) {
      summary.errors.push({ account_id: a.id, error: (e as Error).message });
    }
  }
  return summary;
}
