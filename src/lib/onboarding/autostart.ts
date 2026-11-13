// Closed-won → Active Customer. A daily cron scans deals closed-won in the last
// window and marks their company an Active Customer (the local crm_customer_flags
// flag that drives the Customers tab), then alerts the team. It deliberately does
// NOT open an onboarding case — onboarding is started by hand from the company's
// Onboarding tab when the merchant actually needs it. Chosen over a HubSpot
// webhook because no webhook infra is set up yet; swap to a webhook later.
//
// Local-only: we flag the company in Supabase and never write current_client back
// to HubSpot here (the manual "Mark as Active Customer" button does the
// write-through; the flag is the source of truth for the tab either way).

import type { serviceClient } from "../db/client";
import { listRecentlyWonDeals, dealCompanyId } from "../hubspot/repo";
import { resolveInboundOwner } from "../leads/capture";
import { sendTransactional } from "../send/postmark";
import { isCustomer, setCustomer } from "../crm/customer";
import type { DealRecord } from "../crm/types";

type DB = ReturnType<typeof serviceClient>;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
}

async function notifyCustomerMarked(db: DB, deal: DealRecord, companyId: string): Promise<void> {
  const { ownerId, notifyEmail } = await resolveInboundOwner(db);
  const link = `${appUrl()}/companies/${companyId}?tab=onboarding`;
  const lines = [
    `A deal closed won — the company has been marked an Active Customer.`,
    ``,
    `Deal: ${deal.name ?? "—"}${deal.url ? ` (${deal.url})` : ""}`,
    `Amount: ${deal.amount ?? "?"} ${deal.currency ?? ""}`,
    ``,
    `Onboarding is not started automatically. If this merchant needs it, start`,
    `onboarding from the company's Onboarding tab: ${link}`,
  ];
  await sendTransactional({
    to: notifyEmail,
    subject: `Closed won — ${deal.name ?? "won deal"} marked as customer`,
    textBody: lines.join("\n"),
    htmlBody: lines.map((l) => (l ? `<p style="margin:0 0 8px;">${l}</p>` : "")).join(""),
    ownerId,
    tag: "closedwon-customer",
  }).catch(() => {});
}

export interface ClosedWonSyncResult { won: number; marked: number; skipped: number; failed: number }

export async function markClosedWonCustomers(db: DB, opts: { windowDays?: number; limit?: number } = {}): Promise<ClosedWonSyncResult> {
  const windowDays = opts.windowDays ?? 7;
  const sinceMs = Date.now() - windowDays * 86_400_000;
  const won = await listRecentlyWonDeals(sinceMs, opts.limit ?? 50);
  const res: ClosedWonSyncResult = { won: won.length, marked: 0, skipped: 0, failed: 0 };

  for (const deal of won) {
    try {
      const companyId = await dealCompanyId(deal.id);
      if (!companyId) { res.skipped++; continue; }          // no company to flag
      if (await isCustomer(db, companyId)) { res.skipped++; continue; } // already a customer
      await setCustomer(db, companyId, true, null);
      await notifyCustomerMarked(db, deal, companyId).catch(() => {});
      res.marked++;
    } catch {
      res.failed++;
    }
  }
  return res;
}
