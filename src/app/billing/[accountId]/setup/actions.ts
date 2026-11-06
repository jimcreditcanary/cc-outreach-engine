"use server";

// Billing setup wizard actions (Phase 2). Save configures the account's items +
// contract terms (account stays setup_pending) and shows the first-invoice
// preview. Activate generates per-item usage keys, flips the account to active,
// and reveals the keys once.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { currentUser } from "@/lib/auth/server";
import { isSuperAdmin } from "@/lib/auth/role";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import {
  getBillingAccountById, updateBillingAccount, updateBillingAccountExtended, replaceBillingItems, listBillingItems, listBands,
  currentPricingByItemType, setItemPricingSnapshot, logBillingAudit, logContractStatusEvent, type BillingItemInput,
} from "@/lib/billing/repo";
import { CATALOGUE, type Metric } from "@/lib/billing/catalogue";
import { itemInScope } from "@/lib/billing/offering";
import { parseItemConfig } from "@/lib/billing/itemConfig";
import { buildPricingSnapshot } from "@/lib/billing/pricingSnapshot";
import { generateUsageKey } from "@/lib/billing/usageKey";
import { getXero } from "@/lib/integrations/xero";
import { getCrm } from "@/lib/crm";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const intOrNull = (v: string): number | null => { const n = Number(v); return v.trim() === "" || Number.isNaN(n) ? null : Math.trunc(n); };

// Metrics that report usage → get a usage API key at activation.
const USAGE_METRICS = new Set<Metric>([
  "per_request", "per_account_month", "per_txn_fixed", "per_txn_pct", "per_txn_fixed_and_pct",
  "per_message", "per_number_month", "pct_of_principal", "per_application",
]);

export async function saveBillingSetupAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("account_id"));
  if (!id) return redirect("/billing");
  const db = serviceClient();
  const account = await getBillingAccountById(db, id);
  if (!account) { await flash("error", "Billing account not found."); return redirect("/billing"); }

  // Only a super-admin may set unit prices (S2). For everyone else the price
  // comes from the catalogue; the deal owner may still toggle "included" and the
  // setup-fee trigger. Enforced here so a crafted POST can't bypass the UI.
  const canEditPrices = await isSuperAdmin();
  // Case product groups — gate which items may be configured (U4 server guard,
  // mirrors the greyed-out items in the wizard).
  let productGroups: string[] = [];
  if (account.onboarding_case_id) {
    const { data: c } = await db.from("onboarding_cases").select("product_groups").eq("id", account.onboarding_case_id).maybeSingle();
    productGroups = (c?.product_groups as string[] | undefined) ?? [];
  }
  const pricing = await currentPricingByItemType(db);
  const items: BillingItemInput[] = [];
  for (const entry of CATALOGUE) {
    if (str(formData.get(`item_${entry.key}`)) !== "on") continue;
    if (!itemInScope(entry, productGroups)) continue; // refuse out-of-scope even via a crafted POST
    const table = pricing.get(entry.key);
    const metric = (table?.metric ?? entry.metric) as Metric;
    const vat = table?.vat_treatment ?? entry.vat;
    let config: Record<string, unknown>;
    if (canEditPrices) {
      config = parseItemConfig(metric, (field) => str(formData.get(`cfg_${entry.key}_${field}`))) as unknown as Record<string, unknown>;
    } else {
      // Catalogue prices + only the non-price controls the deal owner may set.
      const base = { ...((table?.config as Record<string, unknown>) ?? {}) };
      base.included = str(formData.get(`cfg_${entry.key}_included`)) === "on";
      const trigger = str(formData.get(`cfg_${entry.key}_billing_trigger`));
      if (trigger) base.billing_trigger = trigger;
      config = base;
    }
    items.push({ pricing_table_id: table?.id ?? null, item_type: entry.key, config, vat_treatment: vat, usage_api_key_hash: null });
  }

  try {
    await replaceBillingItems(db, id, items);
    await updateBillingAccount(db, id, {
      contract_start_date: str(formData.get("contract_start_date")) || null,
      finance_contact_id: str(formData.get("finance_contact_id")) || null,
      po_number: str(formData.get("po_number")) || null,
    });
    // 073/074 columns (invoice mode + contract lifecycle) — best-effort so they
    // no-op before those migrations are applied. term_end_date /
    // renewal_decision_date are generated from these.
    await updateBillingAccountExtended(db, id, {
      billing_type: str(formData.get("billing_type")) === "draft" ? "draft" : "auto",
      term_months: intOrNull(str(formData.get("term_months"))),
      notice_months: intOrNull(str(formData.get("notice_months"))),
      break_months: intOrNull(str(formData.get("break_months"))),
      auto_renew: str(formData.get("auto_renew")) === "on",
    });
    await logBillingAudit(db, { account_id: id, actor_user_id: me.id, actor_email: me.email ?? null, action: "items_configured", payload: { count: items.length } });
    await flash("success", `Saved ${items.length} item${items.length === 1 ? "" : "s"}. Review the first-invoice preview below, then activate.`);
  } catch (e) {
    await flash("error", `Save failed: ${(e as Error).message}`);
  }
  revalidatePath(`/billing/${id}/setup`);
  redirect(`/billing/${id}/setup`);
}

export async function activateBillingAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("account_id"));
  if (!id) return redirect("/billing");
  const db = serviceClient();
  const account = await getBillingAccountById(db, id);
  if (!account) { await flash("error", "Billing account not found."); return redirect("/billing"); }
  if (!account.contract_start_date) { await flash("error", "Set a contract start date before activating."); return redirect(`/billing/${id}/setup`); }

  const items = await listBillingItems(db, id);
  if (!items.length) { await flash("error", "Configure at least one item before activating."); return redirect(`/billing/${id}/setup`); }

  const pricing = await currentPricingByItemType(db);
  const reveals: { item_type: string; label: string; key: string }[] = [];
  let nonce = "";
  try {
    const nowIso = new Date().toISOString();
    for (const it of items) {
      const table = pricing.get(it.item_type) ?? null;
      const metric = (table?.metric ?? "flat_monthly") as Metric;
      // L3: freeze the pricing in force so a later catalogue edit never reprices
      // this contract. The invoice run reads this snapshot in preference to live.
      const bands = table ? await listBands(db, table.id) : [];
      const snapshot = buildPricingSnapshot(table, bands, it.config, it.vat_treatment, metric, nowIso);
      await setItemPricingSnapshot(db, it.id, snapshot as unknown as Record<string, unknown>, 1, nowIso);
      // Usage key only for usage-reporting metrics that aren't sold as included.
      if (!USAGE_METRICS.has(metric)) continue;
      if ((it.config as { included?: boolean }).included) continue;
      const { key, hash } = generateUsageKey();
      await db.from("billing_items").update({ usage_api_key_hash: hash }).eq("id", it.id);
      reveals.push({ item_type: it.item_type, label: CATALOGUE.find((c) => c.key === it.item_type)?.label ?? it.item_type, key });
    }
    // L6: create the Xero contact at activation (not lazily at first run). Non-
    // fatal — the invoice run still creates it lazily if this fails.
    if (!account.xero_contact_id) {
      try {
        const crm = getCrm();
        const company = account.hubspot_company_id ? await crm.getCompany(account.hubspot_company_id).catch(() => null) : null;
        const fin = account.finance_contact_id ? await crm.getContact(account.finance_contact_id).catch(() => null) : null;
        const c = await getXero().ensureContact({
          accountKey: account.id,
          name: company?.name ?? account.hubspot_company_id ?? account.id,
          financeContact: fin ? { name: fin.full_name, email: fin.email, phone: null } : null,
        });
        await updateBillingAccount(db, id, { xero_contact_id: c.contactId });
      } catch { /* non-fatal */ }
    }
    await updateBillingAccount(db, id, { status: "active" });
    await logContractStatusEvent(db, id, "active", "ui", { activated_by: me.email });
    await logBillingAudit(db, { account_id: id, actor_user_id: me.id, actor_email: me.email ?? null, action: "account_activated", payload: { items: items.length, keys: reveals.length } });
    if (reveals.length) {
      nonce = randomBytes(18).toString("base64url");
      await db.from("billing_key_reveals").insert({ nonce, account_id: id, reveals });
    }
    await flash("success", "Billing activated.");
  } catch (e) {
    await flash("error", `Activation failed: ${(e as Error).message}`);
    return redirect(`/billing/${id}/setup`);
  }
  revalidatePath(`/billing/${id}`);
  redirect(nonce ? `/billing/${id}/keys/${nonce}` : `/billing/${id}`);
}

// D1 — "Mark contract signed". Stamps contract_signed_at so the setup fee bills
// per its trigger (L4). Any operator may mark it; it's append-logged.
export async function markContractSignedAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("account_id"));
  if (!id) return redirect("/billing");
  const db = serviceClient();
  const account = await getBillingAccountById(db, id);
  if (!account) { await flash("error", "Billing account not found."); return redirect("/billing"); }
  const signedAt = new Date().toISOString();
  try {
    await updateBillingAccount(db, id, { contract_signed_at: signedAt });
    await logContractStatusEvent(db, id, "signed", "ui", { effective_at: signedAt, marked_by: me.email });
    await logBillingAudit(db, { account_id: id, actor_user_id: me.id, actor_email: me.email ?? null, action: "contract_signed", payload: { signed_at: signedAt } });
    await flash("success", "Contract marked as signed. The setup fee will bill on the next run.");
  } catch (e) {
    await flash("error", `Could not mark signed: ${(e as Error).message}`);
  }
  revalidatePath(`/billing/${id}`);
  revalidatePath(`/billing/${id}/setup`);
  redirect(`/billing/${id}`);
}

// L3 — re-sync an account's item pricing from the current catalogue (supersede).
// Super-admin only. Future invoices use the refreshed snapshot; invoices already
// raised are untouched (they were computed from the snapshot then in force).
export async function resyncItemPricingAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  if (!(await isSuperAdmin())) { await flash("error", "Only a super-admin can re-sync pricing."); return redirect("/billing"); }
  const id = str(formData.get("account_id"));
  if (!id) return redirect("/billing");
  const db = serviceClient();
  const account = await getBillingAccountById(db, id);
  if (!account) { await flash("error", "Billing account not found."); return redirect("/billing"); }

  try {
    const [items, pricing] = await Promise.all([listBillingItems(db, id), currentPricingByItemType(db)]);
    const nowIso = new Date().toISOString();
    let n = 0;
    for (const it of items) {
      if (!it.active) continue;
      const table = pricing.get(it.item_type) ?? null;
      const bands = table ? await listBands(db, table.id) : [];
      const metric = (table?.metric ?? "flat_monthly") as Metric;
      const snapshot = buildPricingSnapshot(table, bands, it.config, it.vat_treatment, metric, nowIso);
      await setItemPricingSnapshot(db, it.id, snapshot as unknown as Record<string, unknown>, (it.pricing_snapshot_version ?? 0) + 1, nowIso);
      n += 1;
    }
    await logBillingAudit(db, { account_id: id, actor_user_id: me.id, actor_email: me.email ?? null, action: "pricing_resynced", payload: { items: n } });
    await flash("success", `Re-synced pricing for ${n} item${n === 1 ? "" : "s"} from the catalogue.`);
  } catch (e) {
    await flash("error", `Re-sync failed: ${(e as Error).message}`);
  }
  revalidatePath(`/billing/${id}`);
  redirect(`/billing/${id}`);
}
