"use server";

// Super-admin-only pricing catalogue actions. Every action re-checks the role
// server-side (never trust the page gate alone). Money is entered + stored as
// integer pence.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { isSuperAdmin } from "@/lib/auth/role";
import { updatePricingTable, saveBands, createPricingVersion } from "@/lib/billing/repo";
import { parseBandsText } from "@/lib/billing/bands";
import { METRICS, VAT_TREATMENTS, type Metric, type VatTreatment } from "@/lib/billing/catalogue";

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
  const db = serviceClient();
  try {
    await updatePricingTable(db, id, {
      name: str(formData.get("name")),
      product_group: str(formData.get("product_group")) || null,
      metric,
      vat_treatment: vat,
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
