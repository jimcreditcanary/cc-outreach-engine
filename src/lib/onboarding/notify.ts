// Onboarding notifications — all INTERNAL. The customer is never emailed; the
// onboarding form link is shared by the salesperson from the company / case page.
//  - Merchant submitted → routes the case to ops@ for internal review (7b).
//  - API-sandbox request → emails the team to set up sandbox access.

import type { serviceClient } from "../db/client";
import { getDeal } from "../hubspot/repo";
import { resolveInboundOwner } from "../leads/capture";
import { sendTransactional } from "../send/postmark";
import { getCase } from "./cases";

type DB = ReturnType<typeof serviceClient>;

/** Internal review inbox for completed onboarding submissions. */
const OPS_EMAIL = "ops@creditcanary.co.uk";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
}

/** Route a submitted onboarding to ops@ for internal review (feedback item 7b). */
export async function notifyMerchantSubmitted(db: DB, caseId: string): Promise<void> {
  const c = await getCase(db, caseId);
  if (!c) return;
  const deal = c.hubspot_deal_id ? await getDeal(c.hubspot_deal_id).catch(() => null) : null;
  const { ownerId } = await resolveInboundOwner(db);
  const lines = [
    "A customer has completed their onboarding form — please review.",
    "",
    `Deal: ${deal?.name ?? "—"}`,
    `Company number: ${c.company_number ?? "—"}`,
    "",
    `Review: ${appUrl()}/onboarding/${caseId}/review`,
  ];
  await sendTransactional({
    to: OPS_EMAIL,
    subject: `Onboarding ready for review — ${deal?.name ?? c.company_number ?? caseId}`,
    textBody: lines.join("\n"),
    htmlBody: lines.map((l) => (l ? `<p style="margin:0 0 8px;">${l}</p>` : "")).join(""),
    ownerId,
    tag: "onboarding-ops-review",
  }).catch(() => {});
}

export async function requestApiSandbox(db: DB, caseId: string): Promise<boolean> {
  const c = await getCase(db, caseId);
  if (!c) return false;
  const deal = c.hubspot_deal_id ? await getDeal(c.hubspot_deal_id).catch(() => null) : null;
  const { ownerId, notifyEmail } = await resolveInboundOwner(db);
  const who = deal?.name || c.company_number || caseId;
  const lines = [
    `API sandbox access requested for an onboarding case.`,
    ``,
    `Deal: ${deal?.name ?? "—"}${deal?.url ? ` (${deal.url})` : ""}`,
    `Company number: ${c.company_number ?? "—"}`,
    `Product groups: ${c.product_groups.join(", ") || "—"}`,
    ``,
    `Set them up with API sandbox access.`,
  ];
  await sendTransactional({
    to: notifyEmail,
    subject: `API sandbox request — ${who}`,
    textBody: lines.join("\n"),
    htmlBody: lines.map((l) => (l ? `<p style="margin:0 0 8px;">${l}</p>` : "")).join(""),
    ownerId,
    tag: "onboarding-sandbox-request",
  }).catch(() => {});
  return true;
}
