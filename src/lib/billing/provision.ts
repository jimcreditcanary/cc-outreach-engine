// Billing provisioning: when an onboarding case reaches `onboarded`, make sure
// it has a billing_account (status setup_pending), mirror the HubSpot deal line
// items read-only, and email the deal owner a link to set billing up. Called
// inline from the approve action and from the daily reconcile cron (so a failed
// inline create self-heals). Idempotent per onboarding case.

import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/auth/admin";
import { sendTransactional } from "@/lib/send/postmark";
import { appendSignatureHtml, appendSignatureText } from "@/lib/send/signature";
import { getDealLineItems } from "@/lib/hubspot/repo";
import { createBillingAccount, getBillingAccountByCase, logContractStatusEvent, type BillingAccount } from "./repo";

type DB = SupabaseClient;

export interface CaseForBilling {
  id: string;
  hubspot_deal_id: string | null;
  hubspot_company_id: string | null;
  deal_owner_user_id: string | null;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk").replace(/\/$/, "");
}

async function financeContactId(db: DB, caseId: string): Promise<string | null> {
  const { data } = await db
    .from("onboarding_stakeholders")
    .select("hubspot_contact_id, role")
    .eq("case_id", caseId)
    .eq("role", "finance")
    .maybeSingle();
  return (data?.hubspot_contact_id as string | undefined) ?? null;
}

/** Copy the deal's HubSpot line items into the read-only mirror. Best-effort. */
async function mirrorLineItems(db: DB, account: BillingAccount): Promise<number> {
  if (!account.hubspot_deal_id) return 0;
  const items = await getDealLineItems(account.hubspot_deal_id);
  if (!items.length) return 0;
  await db.from("billing_hubspot_line_items_mirror").delete().eq("account_id", account.id);
  const rows = items.map((it) => ({
    account_id: account.id,
    hubspot_line_item_id: it.id,
    name: it.name,
    sku: it.sku,
    quantity: it.quantity,
    price: it.price,
    amount: it.amount,
    term: it.term,
    properties: it.properties,
  }));
  const ins = await db.from("billing_hubspot_line_items_mirror").insert(rows);
  return ins.error ? 0 : rows.length;
}

/** Email the deal owner a link to set billing up (Jim's signature). Best-effort. */
async function emailDealOwner(account: BillingAccount): Promise<boolean> {
  if (!account.deal_owner_user_id) return false;
  const { data } = await adminClient().auth.admin.getUserById(account.deal_owner_user_id);
  const to = data?.user?.email;
  if (!to) return false;
  const link = `${appUrl()}/billing/${account.id}`;
  const textBody = appendSignatureText(
    [
      "A merchant has completed onboarding and is ready for billing setup.",
      "",
      "Set up their pricing and contract terms here:",
      link,
    ].join("\n"),
  );
  const htmlBody = appendSignatureHtml(
    `<p>A merchant has completed onboarding and is ready for billing setup.</p>` +
      `<p><a href="${link}">Set up their pricing and contract terms</a>.</p>`,
  );
  const res = await sendTransactional({
    to,
    subject: "Set up billing for a newly onboarded merchant",
    textBody,
    htmlBody,
    tag: "billing-setup-invite",
  });
  return !!res;
}

export interface ProvisionResult {
  account: BillingAccount;
  created: boolean;
  lineItemsMirrored: number;
  emailed: boolean;
}

/** Ensure the case has a billing_account; create + mirror + email on first run.
 *  Idempotent: returns the existing account untouched on subsequent calls. */
export async function ensureBillingForCase(db: DB, c: CaseForBilling): Promise<ProvisionResult> {
  const existing = await getBillingAccountByCase(db, c.id);
  if (existing) return { account: existing, created: false, lineItemsMirrored: 0, emailed: false };

  const account = await createBillingAccount(db, {
    onboarding_case_id: c.id,
    hubspot_company_id: c.hubspot_company_id,
    hubspot_deal_id: c.hubspot_deal_id,
    finance_contact_id: await financeContactId(db, c.id),
    deal_owner_user_id: c.deal_owner_user_id,
  });
  await logContractStatusEvent(db, account.id, "setup_pending", "ui", { via: "onboarding.approved" });

  // Side effects are best-effort — a failure here must not undo the account.
  const lineItemsMirrored = await mirrorLineItems(db, account).catch(() => 0);
  const emailed = await emailDealOwner(account).catch(() => false);
  return { account, created: true, lineItemsMirrored, emailed };
}

export interface ReconcileResult {
  scanned: number;
  created: number;
  errors: { caseId: string; error: string }[];
}

/** Backfill billing accounts for any `onboarded` case that doesn't have one yet
 *  (self-heals a failed inline create). Run from the daily cron. */
export async function reconcileBilling(db: DB, limit = 50): Promise<ReconcileResult> {
  const { data: cases, error } = await db
    .from("onboarding_cases")
    .select("id, hubspot_deal_id, hubspot_company_id, deal_owner_user_id")
    .eq("status", "onboarded")
    .limit(500);
  if (error) throw error;
  const { data: accts } = await db.from("billing_accounts").select("onboarding_case_id").not("onboarding_case_id", "is", null);
  const have = new Set((accts ?? []).map((a) => (a as { onboarding_case_id: string }).onboarding_case_id));
  const missing = (cases ?? []).filter((c) => !have.has((c as { id: string }).id)).slice(0, limit);

  const result: ReconcileResult = { scanned: missing.length, created: 0, errors: [] };
  for (const c of missing as CaseForBilling[]) {
    try {
      const r = await ensureBillingForCase(db, c);
      if (r.created) result.created += 1;
    } catch (e) {
      result.errors.push({ caseId: c.id, error: (e as Error).message });
    }
  }
  return result;
}
