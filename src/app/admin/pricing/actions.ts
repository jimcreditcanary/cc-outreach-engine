"use server";

// Super-admin-only pricing catalogue actions. Every action re-checks the role
// server-side (never trust the page gate alone). Money is entered + stored as
// integer pence.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { isSuperAdmin } from "@/lib/auth/role";
import { updatePricingTable, saveBands, createPricingVersion, createProduct, upsertGroupMinimum } from "@/lib/billing/repo";
import { parseBandsText } from "@/lib/billing/bands";
import { parseItemConfig } from "@/lib/billing/itemConfig";
import { poundsToPence } from "@/lib/billing/money";
import { METRICS, VAT_TREATMENTS, type Metric, type VatTreatment } from "@/lib/billing/catalogue";

const bandMode = (v: FormDataEntryValue | null): "volume" | "graduated" => (str(v) === "graduated" ? "graduated" : "volume");
const productType = (v: FormDataEntryValue | null): "fixed" | "variable" => (str(v) === "fixed" ? "fixed" : "variable");

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const BACK = "/admin/pricing";

async function guard(): Promise<boolean> {
  if (await isSuperAdmin()) return true;
  await flash("error", "Pricing is super-admin only.");
  return false;
}

export async function updatePricingTableAction(formData: FormData) {
  if (!(await guard())) return redirect(BACK);
  const id = str(formData.get("table_id"));
  if (!id) return redirect(BACK);
  const metric = str(formData.get("metric")) as Metric;
  const vat = str(formData.get("vat_treatment")) as VatTreatment;
  if (!METRICS.includes(metric) || !VAT_TREATMENTS.includes(vat)) {
    await flash("error", "Invalid metric or VAT treatment.");
    return redirect(BACK);
  }
  // Per-metric default price, stored on the pricing table's config — the
  // catalogue standard rate that flows into every account's invoices (unless
  // overridden per account).
  const config = parseItemConfig(metric, (f) => str(formData.get(`cfg_${f}`))) as unknown as Record<string, unknown>;
  const db = serviceClient();
  try {
    await updatePricingTable(db, id, {
      name: str(formData.get("name")),
      product_group: str(formData.get("product_group")) || null,
      metric,
      vat_treatment: vat,
      band_mode: bandMode(formData.get("band_mode")),
      product_type: productType(formData.get("product_type")),
      billing_frequency: str(formData.get("billing_frequency")) || null,
      active: str(formData.get("active")) === "on",
      internal_notes: str(formData.get("internal_notes")) || null,
      config,
      is_placeholder: str(formData.get("is_placeholder")) === "on",
    });
    await saveBands(db, id, parseBandsText(str(formData.get("bands"))));
    await flash("success", "Pricing updated.");
  } catch (e) {
    await flash("error", `Update failed: ${(e as Error).message}`);
  }
  revalidatePath(BACK);
  redirect(BACK);
}

export async function createProductAction(formData: FormData) {
  if (!(await guard())) return redirect(BACK);
  const item_type = str(formData.get("item_type")).toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z0-9_]+$/.test(item_type)) {
    await flash("error", "Product key must be lowercase letters, numbers and underscores (e.g. tu_new_product).");
    return redirect(BACK);
  }
  const metric = str(formData.get("metric")) as Metric;
  const vat = str(formData.get("vat_treatment")) as VatTreatment;
  if (!METRICS.includes(metric) || !VAT_TREATMENTS.includes(vat)) {
    await flash("error", "Invalid metric or VAT treatment.");
    return redirect(BACK);
  }
  const config = parseItemConfig(metric, (f) => str(formData.get(`cfg_${f}`))) as unknown as Record<string, unknown>;
  try {
    await createProduct(serviceClient(), {
      item_type,
      name: str(formData.get("name")) || item_type,
      product_group: str(formData.get("product_group")) || null,
      metric,
      product_type: productType(formData.get("product_type")),
      band_mode: bandMode(formData.get("band_mode")),
      vat_treatment: vat,
      billing_frequency: str(formData.get("billing_frequency")) || null,
      config,
      internal_notes: str(formData.get("internal_notes")) || null,
      is_placeholder: str(formData.get("is_placeholder")) === "on",
    }, parseBandsText(str(formData.get("bands"))));
    await flash("success", `Product "${item_type}" created.`);
  } catch (e) {
    await flash("error", `Create failed: ${(e as Error).message}`);
  }
  revalidatePath(BACK);
  redirect(BACK);
}

export async function saveGroupMinimumAction(formData: FormData) {
  if (!(await guard())) return redirect(BACK);
  const group = str(formData.get("product_group"));
  if (!group) { await flash("error", "Pick a product group."); return redirect(BACK); }
  try {
    await upsertGroupMinimum(serviceClient(), group, poundsToPence(str(formData.get("minimum"))), str(formData.get("note")) || null);
    await flash("success", `Category minimum for ${group} saved.`);
  } catch (e) {
    await flash("error", `Save failed: ${(e as Error).message}`);
  }
  revalidatePath(BACK);
  redirect(BACK);
}

export async function createPricingVersionAction(formData: FormData) {
  if (!(await guard())) return redirect(BACK);
  const id = str(formData.get("table_id"));
  if (!id) return redirect(BACK);
  const effectiveFrom = str(formData.get("effective_from")) || new Date().toISOString().slice(0, 10);
  try {
    await createPricingVersion(serviceClient(), id, effectiveFrom);
    await flash("success", `New version effective ${effectiveFrom}.`);
  } catch (e) {
    await flash("error", `New version failed: ${(e as Error).message}`);
  }
  revalidatePath(BACK);
  redirect(BACK);
}
