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
  band_mode: "volume" | "graduated";
  product_type: "fixed" | "variable";
  billing_frequency: string | null;
  delayed_start_months: number;
  active: boolean;
  internal_notes: string | null;
  sort_order: number;
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
  unit_cap_pence: number | null;
  sort_order: number;
}

export interface GroupMinimum {
  product_group: string;
  minimum_pence: number;
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
  po_number: string | null;
  created_at: string;
  updated_at: string;
}

const TABLE_COLS =
  "id, item_type, name, product_group, metric, config, vat_treatment, band_mode, product_type, billing_frequency, delayed_start_months, active, internal_notes, sort_order, is_placeholder, version, effective_from, effective_to, created_at, updated_at";
const BAND_COLS = "id, pricing_table_id, from_units, to_units, unit_price_pence, minimum_type, minimum_pence, unit_cap_pence, sort_order";
const ACCT_COLS =
  "id, onboarding_case_id, hubspot_company_id, hubspot_deal_id, xero_contact_id, contract_start_date, contract_signed_at, notice_period_days, contract_end_date, status, finance_contact_id, deal_owner_user_id, po_number, created_at, updated_at";

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
  Pick<PricingTable, "name" | "product_group" | "metric" | "config" | "vat_treatment" | "band_mode" | "product_type" | "billing_frequency" | "delayed_start_months" | "active" | "internal_notes" | "sort_order" | "is_placeholder" | "effective_from" | "effective_to">
>;

export interface NewProduct {
  item_type: string;
  name: string;
  product_group: string | null;
  metric: Metric;
  product_type: "fixed" | "variable";
  band_mode: "volume" | "graduated";
  vat_treatment: VatTreatment;
  billing_frequency: string | null;
  config: Record<string, unknown>;
  internal_notes: string | null;
  is_placeholder: boolean;
}

/** Create a brand-new product (version 1, effective today) + its bands. Rejects
 *  a key that already exists — editing an existing product goes through the
 *  table/version actions instead. */
export async function createProduct(db: DB, input: NewProduct, bands: BandInput[]): Promise<string> {
  const { data: existing, error: selErr } = await db.from("billing_pricing_tables").select("id").eq("item_type", input.item_type).limit(1);
  if (selErr) throw selErr;
  if (existing && existing.length) throw new Error(`a product with key "${input.item_type}" already exists`);
  const { data, error } = await db.from("billing_pricing_tables").insert({
    item_type: input.item_type, name: input.name, product_group: input.product_group, metric: input.metric,
    product_type: input.product_type, band_mode: input.band_mode, vat_treatment: input.vat_treatment,
    billing_frequency: input.billing_frequency, config: input.config, internal_notes: input.internal_notes,
    is_placeholder: input.is_placeholder, active: true, version: 1,
  }).select("id").single();
  if (error) throw error;
  const id = data.id as string;
  if (bands.length) await saveBands(db, id, bands);
  return id;
}

export interface GroupMinimumRow { id: string; product_group: string; minimum_pence: number; note: string | null }

/** Every current group-minimum row (including 0), newest per group — for the editor. */
export async function listGroupMinimums(db: DB): Promise<GroupMinimumRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from("billing_group_minimums")
    .select("id, product_group, minimum_pence, note, effective_from, effective_to")
    .lte("effective_from", today).order("effective_from", { ascending: false });
  if (error) throw error;
  const seen = new Map<string, GroupMinimumRow>();
  for (const r of (data ?? []) as (GroupMinimumRow & { effective_to: string | null })[]) {
    if (r.effective_to && r.effective_to <= today) continue;
    if (!seen.has(r.product_group)) seen.set(r.product_group, { id: r.id, product_group: r.product_group, minimum_pence: r.minimum_pence, note: r.note });
  }
  return [...seen.values()];
}

/** Set a product-group's monthly minimum — updates the current row, or inserts one. */
export async function upsertGroupMinimum(db: DB, productGroup: string, minimumPence: number, note: string | null): Promise<void> {
  const current = (await listGroupMinimums(db)).find((g) => g.product_group === productGroup);
  if (current) {
    const { error } = await db.from("billing_group_minimums").update({ minimum_pence: minimumPence, note }).eq("id", current.id);
    if (error) throw error;
  } else {
    const { error } = await db.from("billing_group_minimums").insert({ product_group: productGroup, minimum_pence: minimumPence, note });
    if (error) throw error;
  }
}

export async function updatePricingTable(db: DB, id: string, patch: PricingTablePatch): Promise<void> {
  const { error } = await db.from("billing_pricing_tables").update(patch).eq("id", id);
  if (error) throw error;
}

export type BandInput = Omit<PricingBand, "id" | "pricing_table_id" | "unit_cap_pence"> & { unit_cap_pence?: number | null };

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
      band_mode: base.band_mode,
      product_type: base.product_type,
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
        unit_cap_pence: b.unit_cap_pence,
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

export type AccountPatch = Partial<
  Pick<BillingAccount, "contract_start_date" | "contract_signed_at" | "notice_period_days" | "contract_end_date" | "status" | "finance_contact_id" | "xero_contact_id">
> & { po_number?: string | null };

export async function updateBillingAccount(db: DB, id: string, patch: AccountPatch): Promise<void> {
  const { error } = await db.from("billing_accounts").update(patch).eq("id", id);
  if (error) throw error;
}

// ─── billing items (Phase 2 setup) ────────────────────────────────────────────

export interface BillingItem {
  id: string;
  account_id: string;
  pricing_table_id: string | null;
  item_type: string;
  config: Record<string, unknown>;
  vat_treatment: string | null;
  override: Record<string, unknown> | null;
  override_by: string | null;
  override_reason: string | null;
  usage_api_key_hash: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const ITEM_COLS =
  "id, account_id, pricing_table_id, item_type, config, vat_treatment, override, override_by, override_reason, usage_api_key_hash, active, created_at, updated_at";

export async function listBillingItems(db: DB, accountId: string): Promise<BillingItem[]> {
  const { data, error } = await db.from("billing_items").select(ITEM_COLS).eq("account_id", accountId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BillingItem[];
}

export async function getBillingItemById(db: DB, id: string): Promise<BillingItem | null> {
  const { data, error } = await db.from("billing_items").select(ITEM_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as BillingItem | null) ?? null;
}

export interface BillingItemInput {
  pricing_table_id: string | null;
  item_type: string;
  config: Record<string, unknown>;
  vat_treatment: string | null;
  usage_api_key_hash: string | null;
}

/** Replace all items for an account (clean re-submit of the wizard). */
export async function replaceBillingItems(db: DB, accountId: string, items: BillingItemInput[]): Promise<void> {
  const del = await db.from("billing_items").delete().eq("account_id", accountId);
  if (del.error) throw del.error;
  if (!items.length) return;
  const ins = await db.from("billing_items").insert(items.map((it) => ({ ...it, account_id: accountId, active: true })));
  if (ins.error) throw ins.error;
}

export async function setBillingItemOverride(
  db: DB,
  itemId: string,
  override: Record<string, unknown> | null,
  byUserId: string | null,
  reason: string,
): Promise<void> {
  const { error } = await db.from("billing_items").update({ override, override_by: byUserId, override_reason: reason }).eq("id", itemId);
  if (error) throw error;
}

/** The current effective pricing table for each item_type (latest version whose
 *  effective window covers today), keyed by item_type. */
export async function currentPricingByItemType(db: DB): Promise<Map<string, PricingTable>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("billing_pricing_tables")
    .select(TABLE_COLS)
    .lte("effective_from", today)
    .order("effective_from", { ascending: false })
    .order("version", { ascending: false });
  if (error) throw error;
  const map = new Map<string, PricingTable>();
  for (const t of (data ?? []) as PricingTable[]) {
    if (t.effective_to && t.effective_to <= today) continue; // closed version
    if (!map.has(t.item_type)) map.set(t.item_type, t); // first = newest effective
  }
  return map;
}

/** Current effective product-group monthly minimums, newest per group. */
export async function currentGroupMinimums(db: DB): Promise<GroupMinimum[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("billing_group_minimums")
    .select("product_group, minimum_pence, effective_from, effective_to")
    .lte("effective_from", today)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  const seen = new Map<string, GroupMinimum>();
  for (const r of (data ?? []) as { product_group: string; minimum_pence: number; effective_to: string | null }[]) {
    if (r.effective_to && r.effective_to <= today) continue;
    if (!seen.has(r.product_group) && r.minimum_pence > 0) seen.set(r.product_group, { product_group: r.product_group, minimum_pence: r.minimum_pence });
  }
  return [...seen.values()];
}

export async function logBillingAudit(
  db: DB,
  input: { account_id: string | null; billing_item_id?: string | null; actor_user_id?: string | null; actor_email?: string | null; action: string; reason?: string | null; payload?: Record<string, unknown> | null },
): Promise<void> {
  await db.from("billing_audit_log").insert({
    account_id: input.account_id,
    billing_item_id: input.billing_item_id ?? null,
    actor_user_id: input.actor_user_id ?? null,
    actor_email: input.actor_email ?? null,
    action: input.action,
    reason: input.reason ?? null,
    payload: input.payload ?? null,
  });
}
