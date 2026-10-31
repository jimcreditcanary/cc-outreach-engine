// Notice-period + anniversary nudges (weekly cron). Emails the deal owner for
// any account whose notice deadline (contract_end_date − notice_period_days)
// falls within the next 30 days, or whose contract anniversary is within 60.

import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/auth/admin";
import { sendTransactional } from "@/lib/send/postmark";
import { appendSignatureHtml, appendSignatureText } from "@/lib/send/signature";

type DB = SupabaseClient;

const DAY = 86_400_000;
function appUrl(): string { return (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk").replace(/\/$/, ""); }
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / DAY);
}
function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
/** Next anniversary of a start date on/after `from`. */
function nextAnniversary(startISO: string, fromISO: string): string {
  const [, m, d] = startISO.split("-");
  const fromY = Number(fromISO.slice(0, 4));
  for (const y of [fromY, fromY + 1]) {
    const cand = `${y}-${m}-${d}`;
    if (cand >= fromISO) return cand;
  }
  return `${fromY + 1}-${m}-${d}`;
}

export interface NudgeSummary { nudged: number; errors: { account_id: string; error: string }[] }

export async function runNoticeNudge(db: DB, today = new Date().toISOString().slice(0, 10)): Promise<NudgeSummary> {
  const summary: NudgeSummary = { nudged: 0, errors: [] };
  const { data: accounts } = await db.from("billing_accounts")
    .select("id, status, contract_start_date, contract_end_date, notice_period_days, deal_owner_user_id, hubspot_company_id")
    .in("status", ["active", "notice_given"]);

  for (const a of (accounts ?? []) as { id: string; contract_start_date: string | null; contract_end_date: string | null; notice_period_days: number | null; deal_owner_user_id: string | null; hubspot_company_id: string | null }[]) {
    const reasons: string[] = [];
    if (a.contract_end_date && a.notice_period_days != null) {
      const deadline = shiftDays(a.contract_end_date, -a.notice_period_days);
      const d = daysBetween(today, deadline);
      if (d >= 0 && d <= 30) reasons.push(`Notice deadline is ${deadline} (${d} days) — give notice before then to avoid auto-renewal.`);
    }
    if (a.contract_start_date) {
      const anniv = nextAnniversary(a.contract_start_date, today);
      const d = daysBetween(today, anniv);
      if (d >= 0 && d <= 60) reasons.push(`Contract anniversary is ${anniv} (${d} days).`);
    }
    if (!reasons.length) continue;

    try {
      if (!a.deal_owner_user_id) { summary.errors.push({ account_id: a.id, error: "no deal owner" }); continue; }
      const { data } = await adminClient().auth.admin.getUserById(a.deal_owner_user_id);
      const to = data?.user?.email;
      if (!to) { summary.errors.push({ account_id: a.id, error: "no owner email" }); continue; }
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
