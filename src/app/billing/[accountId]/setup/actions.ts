"use server";

// Billing setup wizard actions (Phase 2). Save configures the account's items +
// contract terms (account stays setup_pending) and shows the first-invoice
// preview. Activate generates per-item usage keys, flips the account to active,
// and reveals the keys once.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import {
  getBillingAccountById, updateBillingAccount, replaceBillingItems, listBillingItems,
  currentPricingByItemType, logBillingAudit, logContractStatusEvent, type BillingItemInput,
} from "@/lib/billing/repo";
import { CATALOGUE, type Metric } from "@/lib/billing/catalogue";
import { parseItemConfig } from "@/lib/billing/itemConfig";
import { generateUsageKey } from "@/lib/billing/usageKey";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

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

  const pricing = await currentPricingByItemType(db);
  const items: BillingItemInput[] = [];
  for (const entry of CATALOGUE) {
    if (str(formData.get(`item_${entry.key}`)) !== "on") continue;
    const table = pricing.get(entry.key);
    const metric = (table?.metric ?? entry.metric) as Metric;
    const vat = table?.vat_treatment ?? entry.vat;
    const config = parseItemConfig(metric, (field) => str(formData.get(`cfg_${entry.key}_${field}`)));
    items.push({ pricing_table_id: table?.id ?? null, item_type: entry.key, config: config as unknown as Record<string, unknown>, vat_treatment: vat, usage_api_key_hash: null });
  }

  try {
    await replaceBillingItems(db, id, items);
    await updateBillingAccount(db, id, {
      contract_start_date: str(formData.get("contract_start_date")) || null,
      notice_period_days: Number(str(formData.get("notice_period_days"))) || null,
      finance_contact_id: str(formData.get("finance_contact_id")) || null,
      po_number: str(formData.get("po_number")) || null,
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
    for (const it of items) {
      const metric = (pricing.get(it.item_type)?.metric ?? "") as Metric;
      if (!USAGE_METRICS.has(metric)) continue;
      if ((it.config as { included?: boolean }).included) continue;
      const { key, hash } = generateUsageKey();
      await db.from("billing_items").update({ usage_api_key_hash: hash }).eq("id", it.id);
      reveals.push({ item_type: it.item_type, label: CATALOGUE.find((c) => c.key === it.item_type)?.label ?? it.item_type, key });
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
