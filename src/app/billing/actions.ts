"use server";

// Billing actions invoked from the Company page / billing views. Phase 1:
// "Set up billing" ensures a billing account exists for a company's onboarded
// case (normally auto-created on approval; this covers the manual/edge case).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { isSuperAdmin } from "@/lib/auth/role";
import { ensureBillingForCase } from "@/lib/billing/provision";
import { getBillingItemById, setBillingItemOverride, logBillingAudit } from "@/lib/billing/repo";
import { recordContacted } from "@/lib/billing/dunning";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

export async function setUpBillingAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const companyId = str(formData.get("company_id"));
  if (!companyId) return redirect("/billing");
  const db = serviceClient();
  const { data: c } = await db
    .from("onboarding_cases")
    .select("id, hubspot_deal_id, hubspot_company_id, deal_owner_user_id")
    .eq("hubspot_company_id", companyId)
    .eq("status", "onboarded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!c) {
    await flash("error", "No onboarded onboarding case for this company yet.");
    return redirect(`/companies/${companyId}`);
  }
  let accountId: string;
  try {
    const { account, created } = await ensureBillingForCase(db, c);
    await flash("success", created ? "Billing account created." : "Billing account already exists.");
    accountId = account.id;
  } catch (e) {
    await flash("error", `Set up billing failed: ${(e as Error).message}`);
    return redirect(`/companies/${companyId}`);
  }
  redirect(`/billing/${accountId}`);
}

/** Super-admin override of a billing item's price/band. Mandatory reason; logged.
 *  override JSON blank/"{}" clears the override. */
export async function setItemOverrideAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const itemId = str(formData.get("item_id"));
  const accountId = str(formData.get("account_id"));
  const back = accountId ? `/billing/${accountId}` : "/billing";
  if (!(await isSuperAdmin())) { await flash("error", "Overrides are super-admin only."); return redirect(back); }
  const reason = str(formData.get("reason"));
  if (!reason) { await flash("error", "An override reason is required."); return redirect(back); }

  const raw = str(formData.get("override"));
  let override: Record<string, unknown> | null = null;
  if (raw && raw !== "{}") {
    try { override = JSON.parse(raw) as Record<string, unknown>; }
    catch { await flash("error", "Override must be valid JSON (e.g. {\"amount_pence\":9000})."); return redirect(back); }
  }

  const db = serviceClient();
  const item = await getBillingItemById(db, itemId);
  if (!item) { await flash("error", "Item not found."); return redirect(back); }
  try {
    await setBillingItemOverride(db, itemId, override, me.id, reason);
    await logBillingAudit(db, { account_id: item.account_id, billing_item_id: itemId, actor_user_id: me.id, actor_email: me.email ?? null, action: "item_override", reason, payload: { override } });
    await flash("success", override ? "Override applied." : "Override cleared.");
  } catch (e) {
    await flash("error", `Override failed: ${(e as Error).message}`);
  }
  revalidatePath(back);
  redirect(back);
}

/** Record whether the deal owner has chased a customer about an unpaid invoice
 *  (the per-row toggle on /billing/outstanding). */
export async function markContactedAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const invoiceId = str(formData.get("invoice_id"));
  if (!invoiceId) return redirect("/billing/outstanding");
  const contacted = str(formData.get("contacted")) === "on";
  const note = str(formData.get("note"));
  try {
    await recordContacted(serviceClient(), invoiceId, contacted, note, me.id);
    await flash("success", contacted ? "Marked as contacted." : "Updated.");
  } catch (e) {
    await flash("error", `Update failed: ${(e as Error).message}`);
  }
  revalidatePath("/billing/outstanding");
  redirect("/billing/outstanding");
}
