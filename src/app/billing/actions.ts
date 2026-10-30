"use server";

// Billing actions invoked from the Company page / billing views. Phase 1:
// "Set up billing" ensures a billing account exists for a company's onboarded
// case (normally auto-created on approval; this covers the manual/edge case).

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { ensureBillingForCase } from "@/lib/billing/provision";

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
