// Onboarding notifications. For now the only one is the API-sandbox request:
// there's no self-serve provisioning yet (that lands with the proposals work),
// so completing internal onboarding with "API sandbox required" emails the team
// to set it up — same pattern as the lead sandbox-request.

import type { serviceClient } from "../db/client";
import { getDeal } from "../hubspot/repo";
import { resolveInboundOwner } from "../leads/capture";
import { sendTransactional } from "../send/postmark";
import { SIGNATURE_HTML, SIGNATURE_TEXT } from "../send/signature";
import { getCase } from "./cases";
import { merchantFormUrl } from "./merchantForm";

type DB = ReturnType<typeof serviceClient>;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk";
}

/** Alert the team that the merchant has submitted their onboarding form. */
export async function notifyMerchantSubmitted(db: DB, caseId: string): Promise<void> {
  const c = await getCase(db, caseId);
  if (!c) return;
  const deal = c.hubspot_deal_id ? await getDeal(c.hubspot_deal_id).catch(() => null) : null;
  const { ownerId, notifyEmail } = await resolveInboundOwner(db);
  const lines = [
    "The merchant has submitted their onboarding form.",
    "",
    `Deal: ${deal?.name ?? "—"}`,
    `Company number: ${c.company_number ?? "—"}`,
    "",
    `Review: ${appUrl()}/onboarding/${caseId}`,
  ];
  await sendTransactional({
    to: notifyEmail,
    subject: `Merchant onboarding submitted — ${deal?.name ?? c.company_number ?? caseId}`,
    textBody: lines.join("\n"),
    htmlBody: lines.map((l) => (l ? `<p style="margin:0 0 8px;">${l}</p>` : "")).join(""),
    ownerId,
    tag: "merchant-submitted",
  }).catch(() => {});
}

/** Invite the merchant to complete the public onboarding form. */
export async function sendMerchantInvite(db: DB, opts: { token: string; toEmail: string; firstName?: string | null }): Promise<void> {
  const { ownerId } = await resolveInboundOwner(db);
  const link = merchantFormUrl(opts.token);
  const hi = opts.firstName?.trim() ? `Hi ${opts.firstName.trim()},` : "Hi,";
  const paras = [
    hi,
    "Thanks for choosing Credit Canary. To complete your onboarding, please confirm your business details and ownership information using the secure link below.",
    "It takes about 10–15 minutes. Have your trading details, ownership breakdown and privacy-policy link to hand.",
  ];
  const btn = `<a href="${esc(link)}" style="display:inline-block;padding:11px 20px;border-radius:6px;background:#003566;color:#fff;font-weight:600;text-decoration:none;">Complete your onboarding form</a>`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px;">` +
    paras.map((p) => `<p style="margin:0 0 16px;">${esc(p)}</p>`).join("") +
    `<p style="margin:0 0 20px;">${btn}</p>` +
    `<p style="margin:0 0 4px;color:#555;font-size:13px;">Or paste this link: ${esc(link)}</p>` +
    `<p style="margin:16px 0 0;color:#555;">Best,</p>` + SIGNATURE_HTML +
    `</div>`;
  const text = `${paras.join("\n\n")}\n\nComplete your onboarding form: ${link}\n\nBest,\n\n${SIGNATURE_TEXT}`;
  await sendTransactional({ to: opts.toEmail, subject: "Complete your Credit Canary onboarding", textBody: text, htmlBody: html, ownerId, tag: "merchant-invite" });
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
