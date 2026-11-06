// Config-only onboarding export for external dev / provisioning automation.
// Powers GET /api/onboarding (customer list), GET /api/onboarding/{caseId}
// (one case's block), and the approval webhook. "Config only": NO sensitive
// PII — bank accounts carry only the masked tail (never the number/sort code),
// and UBOs carry name + declared ownership only (no DOB / address / PEP /
// consent). The merchant-form token is never included.

import type { serviceClient } from "../db/client";
import { getCase } from "./cases";
import { loadMerchantForm } from "./merchantForm";
import { loadGeneratedDocs } from "./docgen";

type DB = ReturnType<typeof serviceClient>;

export interface OnboardingCustomerSummary {
  case_id: string;
  deal_id: string | null;
  company_id: string | null;
  company_number: string | null;
  company_name: string | null;
  status: string;
  product_groups: string[];
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CaseRow {
  id: string; hubspot_deal_id: string | null; hubspot_company_id: string | null;
  company_number: string | null; status: string; product_groups: string[] | null;
  approved_at: string | null; created_at: string; updated_at: string;
}

const CASE_LIST_COLS = "id, hubspot_deal_id, hubspot_company_id, company_number, status, product_groups, approved_at, created_at, updated_at";

/** Directory of onboarding customers + their IDs. `status` of "all" returns
 *  every non-cancelled case; a specific status filters to it; the default is
 *  onboarded (true customers). */
export async function listOnboardingCustomers(db: DB, status = "onboarded"): Promise<OnboardingCustomerSummary[]> {
  let q = db.from("onboarding_cases").select(CASE_LIST_COLS).order("created_at", { ascending: false }).limit(500);
  q = status === "all" ? q.neq("status", "cancelled") : q.eq("status", status);
  const { data } = await q;
  const rows = (data as CaseRow[] | null) ?? [];
  const ids = rows.map((r) => r.id);
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: snaps } = await db.from("onboarding_company_snapshot").select("case_id, company_name").in("case_id", ids);
    for (const x of (snaps as { case_id: string; company_name: string | null }[] | null) ?? []) names.set(x.case_id, x.company_name ?? "");
  }
  return rows.map((r) => ({
    case_id: r.id, deal_id: r.hubspot_deal_id, company_id: r.hubspot_company_id,
    company_number: r.company_number, company_name: names.get(r.id) || null,
    status: r.status, product_groups: r.product_groups ?? [],
    approved_at: r.approved_at ?? null, created_at: r.created_at, updated_at: r.updated_at,
  }));
}

interface SnapshotRow { company_name: string | null; company_type: string | null; company_status: string | null; registered_office: unknown; sic_codes: unknown }
interface UploadMetaRow { kind: string | null; filename: string | null; content_type: string | null; size_bytes: number | null; created_at: string }

/** The config-only onboarding block for one case, or null if the case is gone. */
export async function buildOnboardingExport(db: DB, caseId: string): Promise<Record<string, unknown> | null> {
  const c = await getCase(db, caseId);
  if (!c) return null;
  const [{ data: snap }, mf, { data: uploadRows }, docs, { data: approvedRow }] = await Promise.all([
    db.from("onboarding_company_snapshot").select("company_name, company_type, company_status, registered_office, sic_codes").eq("case_id", caseId).maybeSingle(),
    loadMerchantForm(db, caseId),
    db.from("onboarding_uploads").select("kind, filename, content_type, size_bytes, created_at").eq("case_id", caseId).order("created_at", { ascending: true }),
    loadGeneratedDocs(db, caseId),
    db.from("onboarding_cases").select("approved_at").eq("id", caseId).maybeSingle(),
  ]);
  const snapshot = (snap as SnapshotRow | null) ?? ({} as SnapshotRow);
  const business = mf.form?.business ?? {};
  const comp = mf.form?.compliance ?? {};
  const sig = mf.form?.signatory ?? {};

  return {
    case_id: c.id,
    deal_id: c.hubspot_deal_id,
    company_id: c.hubspot_company_id,
    company_number: c.company_number,
    status: c.status,
    product_groups: c.product_groups,
    api_sandbox_required: c.api_sandbox_required,
    approved_at: (approvedRow as { approved_at: string | null } | null)?.approved_at ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    submitted_at: mf.form?.submitted_at ?? null,
    company: {
      name: snapshot.company_name ?? null,
      type: snapshot.company_type ?? null,
      status: snapshot.company_status ?? null,
      registered_office: snapshot.registered_office ?? null,
      sic_codes: snapshot.sic_codes ?? null,
    },
    business: {
      trading_name: business.trading_name ?? "",
      trading_address: business.trading_address ?? "",
      principal_office: business.principal_office ?? "",
      phone: business.phone ?? "",
      email: business.email ?? "",
      website: business.website ?? "",
      socials: business.socials ?? {},
    },
    compliance: {
      ico_number: comp.ico_number ?? "",
      fca_frn: comp.fca_frn ?? "",
      vat_number: comp.vat_number ?? "",
      trade_body: comp.trade_body ?? "",
      privacy_policy_url: comp.privacy_policy_url ?? "",
      dpo: comp.dpo ?? "",
    },
    signatory: { name: sig.name ?? "", title: sig.title ?? "", email: sig.email ?? "" },
    // UBOs: names + declared ownership only — no DOB / address / PEP / consent.
    ubos: mf.kyc.map((k) => ({ name: k.ubo_name ?? null, ownership_percent: k.exact_ownership_percent ?? null })),
    ubo_count: mf.kyc.length,
    // Bank accounts: masked tail only — never the full number / sort code.
    bank_accounts: mf.bankAccounts.map((a) => ({ purpose: a.purpose, account_name: a.account_name, bank_name: a.bank_name, account_tail: a.account_tail, cop_result: a.cop_result })),
    direct_debit: mf.directDebit ?? null,
    uploads: ((uploadRows as UploadMetaRow[] | null) ?? []).map((u) => ({ kind: u.kind, filename: u.filename, content_type: u.content_type, size_bytes: u.size_bytes, created_at: u.created_at })),
    documents: docs.map((d) => ({ doc_kind: d.doc_kind, filename: d.filename, generated_at: d.generated_at })),
  };
}

/** True when the request carries the onboarding API key (Bearer or X-API-Key).
 *  Returns false when the key isn't configured — callers return 503 for that. */
export function onboardingApiKeyOk(req: Request): boolean {
  const key = process.env.ONBOARDING_API_KEY;
  if (!key) return false;
  return req.headers.get("authorization") === `Bearer ${key}` || req.headers.get("x-api-key") === key;
}

/** POST the config-only block to ONBOARDING_WEBHOOK_URL (if set) when a case is
 *  approved. Best-effort — never throws into the approval flow. */
export async function sendOnboardingWebhook(db: DB, caseId: string): Promise<boolean> {
  const url = process.env.ONBOARDING_WEBHOOK_URL;
  if (!url) return false;
  try {
    const block = await buildOnboardingExport(db, caseId);
    if (!block) return false;
    const secret = process.env.ONBOARDING_WEBHOOK_SECRET;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) },
      body: JSON.stringify({ event: "onboarding.approved", case: block }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
