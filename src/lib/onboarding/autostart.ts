// Closedwon auto-create. A daily cron scans deals closed-won in the last window
// and opens an onboarding case for any that don't already have one (incl.
// cancelled — we never resurrect a case the operator killed), then alerts the
// team. Chosen over a HubSpot webhook because no webhook infra is set up yet;
// swap to a webhook later without touching findOrCreateCaseForDeal.

import type { serviceClient } from "../db/client";
import { listRecentlyWonDeals, dealCompanyId } from "../hubspot/repo";
import { resolveInboundOwner } from "../leads/capture";
import { sendTransactional } from "../send/postmark";
import type { DealRecord } from "../crm/types";
import { anyCaseForDeal, findOrCreateCaseForDeal, logCaseEvent } from "./cases";

type DB = ReturnType<typeof serviceClient>;
const SYSTEM = { email: "system:autostart" };

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
}

async function notifyAutostart(db: DB, deal: DealRecord, caseId: string): Promise<void> {
  const { ownerId, notifyEmail } = await resolveInboundOwner(db);
  const link = `${appUrl()}/onboarding/${caseId}`;
  const lines = [
    `A deal closed won — onboarding has been auto-started.`,
    ``,
    `Deal: ${deal.name ?? "—"}${deal.url ? ` (${deal.url})` : ""}`,
    `Amount: ${deal.amount ?? "?"} ${deal.currency ?? ""}`,
    ``,
    `Work the onboarding wizard: ${link}`,
  ];
  await sendTransactional({
    to: notifyEmail,
    subject: `Onboarding started — ${deal.name ?? "won deal"}`,
    textBody: lines.join("\n"),
    htmlBody: lines.map((l) => (l ? `<p style="margin:0 0 8px;">${l}</p>` : "")).join(""),
    ownerId,
    tag: "onboarding-autostart",
  }).catch(() => {});
}

export interface AutostartResult { won: number; created: number; skipped: number; failed: number }

export async function runOnboardingAutostart(db: DB, opts: { windowDays?: number; limit?: number } = {}): Promise<AutostartResult> {
  const windowDays = opts.windowDays ?? 7;
  const sinceMs = Date.now() - windowDays * 86_400_000;
  const won = await listRecentlyWonDeals(sinceMs, opts.limit ?? 50);
  const res: AutostartResult = { won: won.length, created: 0, skipped: 0, failed: 0 };

  for (const deal of won) {
    try {
      if (await anyCaseForDeal(db, deal.id)) { res.skipped++; continue; }
      const companyId = await dealCompanyId(deal.id);
      const { case: c, created } = await findOrCreateCaseForDeal(db, {
        dealId: deal.id, hubspotCompanyId: companyId, actor: SYSTEM,
      });
      if (!created) { res.skipped++; continue; }
      await logCaseEvent(db, c.id, "autostart_closedwon", SYSTEM, { deal_id: deal.id, deal_name: deal.name });
      await notifyAutostart(db, deal, c.id).catch(() => {});
      res.created++;
    } catch {
      res.failed++;
    }
  }
  return res;
}
