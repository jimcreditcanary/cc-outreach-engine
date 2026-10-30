// Billing data access (pure CRUD). All calls take a serviceClient() DB handle
// (RLS-bypass, server-side only). Orchestration (provisioning, emails, mirror)
// lives in provision.ts; this file just reads/writes rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metric, VatTreatment, AccountStatus } from "./catalogue";

type DB = SupabaseClient;

export interface PricingTable {
  id: string;
  item_type: string;
  name: string;
  product_group: string | null;
  metric: Metric;
  config: Record<string, unknown>;
  vat_treatment: VatTreatment;
  is_placeholder: boolean;
  version: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricingBand {
  id: string;
  pricing_table_id: string;
  from_units: number;
  to_units: number | null;
  unit_price_pence: number;
  minimum_type: "none" | "monthly" | "on_band_hit";
  minimum_pence: number;
  sort_order: number;
}

export interface BillingAccount {
  id: string;
  onboarding_case_id: string | null;
  hubspot_company_id: string | null;
  hubspot_deal_id: string | null;
  xero_contact_id: string | null;
  contract_start_date: string | null;
  contract_signed_at: string | null;
  notice_period_days: number | null;
  contract_end_date: string | null;
  status: AccountStatus;
  finance_contact_id: string | null;
  deal_owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

const TABLE_COLS =
  "id, item_type, name, product_group, metric, config, vat_treatment, is_placeholder, version, effective_from, effective_to, created_at, updated_at";
const BAND_COLS = "id, pricing_table_id, from_units, to_units, unit_price_pence, minimum_type, minimum_pence, sort_order";
const ACCT_COLS =
  "id, onboarding_case_id, hubspot_company_id, hubspot_deal_id, xero_contact_id, contract_start_date, contract_signed_at, notice_period_days, contract_end_date, status, finance_contact_id, deal_owner_user_id, created_at, updated_at";

// ─── pricing tables ───────────────────────────────────────────────────────────

/** Every pricing table row (all item types + all versions), newest effective
 *  first. The admin UI groups these by item_type. */
export async function listPricingTables(db: DB): Promise<PricingTable[]> {
  const { data, error } = await db
    .from("billing_pricing_tables")
    .select(TABLE_COLS)
    .order("item_type", { ascending: true })
    .order("effective_from", { ascending: false })
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PricingTable[];
}

export async function getPricingTable(db: DB, id: string): Promise<PricingTable | null> {
  const { data, error } = await db.from("billing_pricing_tables").select(TABLE_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as PricingTable | null) ?? null;
}

export async function listBands(db: DB, tableId: string): Promise<PricingBand[]> {
  const { data, error } = await db
    .from("billing_pricing_bands")
    .select(BAND_COLS)
    .eq("pricing_table_id", tableId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PricingBand[];
}

export type PricingTablePatch = Partial<
  Pick<PricingTable, "name" | "product_group" | "metric" | "config" | "vat_treatment" | "is_placeholder" | "effective_from" | "effective_to">
>;

export async function updatePricingTable(db: DB, id: string, patch: PricingTablePatch): Promise<void> {
  const { error } = await db.from("billing_pricing_tables").update(patch).eq("id", id);
  if (error) throw error;
}

export type BandInput = Omit<PricingBand, "id" | "pricing_table_id">;

/** Replace all bands for a table (clean resubmit). */
export async function saveBands(db: DB, tableId: string, bands: BandInput[]): Promise<void> {
  const del = await db.from("billing_pricing_bands").delete().eq("pricing_table_id", tableId);
  if (del.error) throw del.error;
  if (!bands.length) return;
  const rows = bands.map((b, i) => ({ ...b, pricing_table_id: tableId, sort_order: b.sort_order ?? i }));
  const ins = await db.from("billing_pricing_bands").insert(rows);
  if (ins.error) throw ins.error;
}

/** Create a new effective-dated version of a table (clone + bands), closing the
 *  prior version at the new effective_from so historic invoices stay reproducible. */
export async function createPricingVersion(db: DB, fromId: string, effectiveFrom: string): Promise<string> {
  const base = await getPricingTable(db, fromId);
  if (!base) throw new Error("pricing table not found");
  const bands = await listBands(db, fromId);
  const { data, error } = await db
    .from("billing_pricing_tables")
    .insert({
      item_type: base.item_type,
      name: base.name,
      product_group: base.product_group,
      metric: base.metric,
      config: base.config,
      vat_treatment: base.vat_treatment,
      is_placeholder: base.is_placeholder,
      version: base.version + 1,
      effective_from: effectiveFrom,
    })
    .select("id")
    .single();
  if (error) throw error;
  const newId = data.id as string;
  if (bands.length) {
    await saveBands(
      db,
      newId,
      bands.map((b) => ({
        from_units: b.from_units,
        to_units: b.to_units,
        unit_price_pence: b.unit_price_pence,
        minimum_type: b.minimum_type,
        minimum_pence: b.minimum_pence,
        sort_order: b.sort_order,
      })),
    );
  }
  // Close the prior version the day before the new one takes effect.
  await db.from("billing_pricing_tables").update({ effective_to: effectiveFrom }).eq("id", fromId);
  return newId;
}

// ─── billing accounts ─────────────────────────────────────────────────────────

export async function getBillingAccountByCase(db: DB, caseId: string): Promise<BillingAccount | null> {
  const { data, error } = await db.from("billing_accounts").select(ACCT_COLS).eq("onboarding_case_id", caseId).maybeSingle();
  if (error) throw error;
  return (data as BillingAccount | null) ?? null;
}

export async function getBillingAccountById(db: DB, id: string): Promise<BillingAccount | null> {
  const { data, error } = await db.from("billing_accounts").select(ACCT_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as BillingAccount | null) ?? null;
}

export async function listBillingAccounts(db: DB): Promise<BillingAccount[]> {
  const { data, error } = await db.from("billing_accounts").select(ACCT_COLS).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BillingAccount[];
}

export type NewBillingAccount = Pick<
  BillingAccount,
  "onboarding_case_id" | "hubspot_company_id" | "hubspot_deal_id" | "finance_contact_id" | "deal_owner_user_id"
>;

export async function createBillingAccount(db: DB, input: NewBillingAccount): Promise<BillingAccount> {
  const { data, error } = await db.from("billing_accounts").insert({ ...input, status: "setup_pending" }).select(ACCT_COLS).single();
  if (error) throw error;
  return data as BillingAccount;
}

export async function logContractStatusEvent(
  db: DB,
  accountId: string,
  status: string,
  source: "api" | "ui",
  payload?: Record<string, unknown>,
): Promise<void> {
  await db.from("billing_contract_status_events").insert({ account_id: accountId, status, source, payload: payload ?? null });
}
