// Onboarding notifications. For now the only one is the API-sandbox request:
// there's no self-serve provisioning yet (that lands with the proposals work),
// so completing internal onboarding with "API sandbox required" emails the team
// to set it up — same pattern as the lead sandbox-request.

import type { serviceClient } from "../db/client";
import { getDeal } from "../hubspot/repo";
import { resolveInboundOwner } from "../leads/capture";
import { sendTransactional } from "../send/postmark";
import { getCase } from "./cases";

type DB = ReturnType<typeof serviceClient>;

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
