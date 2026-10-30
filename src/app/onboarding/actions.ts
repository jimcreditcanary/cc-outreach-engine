"use server";

// Server actions for the Phase 1 internal onboarding wizard. Each step writes to
// the onboarding_cases / _stakeholders tables (migration 048) and logs an event,
// then advances to the next step. Nothing here is customer-facing — the merchant
// invite + public form are Phase 3.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { dealCompanyId, syncDealOnboardingStatus, associateDealContactRole, hubspotRepo } from "@/lib/hubspot/repo";
import {
  findOrCreateCaseForDeal, getCase, updateCase, setProductGroups,
  addStakeholder, removeStakeholder, listStakeholders, logCaseEvent,
  readyToComplete, isOnboardingRole, ONBOARDING_ROLES,
} from "@/lib/onboarding/cases";
import { requestApiSandbox, sendMerchantInvite } from "@/lib/onboarding/notify";
import { enrichCompanyForCase } from "@/lib/onboarding/enrich";
import { assessPrivacyPolicy } from "@/lib/onboarding/privacyAssessment";
import { extractUpload } from "@/lib/onboarding/uploads";
import { runUboChecks } from "@/lib/onboarding/uboChecks";
import { generateDocsForCase } from "@/lib/onboarding/docgen";
import { fileCaseToDrive } from "@/lib/onboarding/driveFiling";
import { parseAccountsForCase } from "@/lib/onboarding/accounts";
import { ensureBillingForCase } from "@/lib/billing/provision";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const actorOf = (u: { id: string; email?: string | null } | null) => ({ id: u?.id ?? null, email: u?.email ?? null });

/** Start (or resume) onboarding for a deal — the "Start onboarding" trigger. */
export async function startOnboardingAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const dealId = str(formData.get("deal_id"));
  if (!dealId) {
    await flash("error", "No deal given.");
    return redirect("/onboarding");
  }
  const db = serviceClient();
  const companyId = await dealCompanyId(dealId);
  const { case: c, created } = await findOrCreateCaseForDeal(db, {
    dealId, hubspotCompanyId: companyId, ownerUserId: me.id, actor: actorOf(me),
  });
  if (created) {
    await syncDealOnboardingStatus(dealId, "started", c.id).catch(() => {});
    await flash("success", "Onboarding started.");
  }
  redirect(`/onboarding/${c.id}`);
}

/** Step 1 — confirm the company (picked from a Companies House search). */
export async function saveCompanyAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  const companyNumber = str(formData.get("company_number"));
  if (!id || !companyNumber) {
    await flash("error", "Pick a company first.");
    return redirect(`/onboarding/${id}?step=company`);
  }
  const db = serviceClient();
  await updateCase(db, id, { company_number: companyNumber });
  await logCaseEvent(db, id, "company_confirmed", actorOf(me), { company_number: companyNumber });
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}?step=products`);
}

/** Step 2 — product groups (auto-select + lock rules applied in setProductGroups). */
export async function saveProductsAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const keys = formData.getAll("groups").map((v) => String(v));
  if (keys.length === 0) {
    await flash("error", "Select at least one product group.");
    return redirect(`/onboarding/${id}?step=products`);
  }
  const db = serviceClient();
  const normalized = await setProductGroups(db, id, keys);
  await logCaseEvent(db, id, "products_set", actorOf(me), { product_groups: normalized });
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}?step=stakeholders`);
}

export async function addStakeholderAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  const contactId = str(formData.get("contact_id"));
  const role = str(formData.get("role"));
  if (!id) return redirect("/onboarding");
  if (!contactId || !isOnboardingRole(role)) {
    await flash("error", "Pick a contact and a role.");
    return redirect(`/onboarding/${id}?step=stakeholders`);
  }
  const db = serviceClient();
  await addStakeholder(db, id, contactId, role);
  // Mirror the role to HubSpot as a labeled deal↔contact association (best-effort;
  // no-ops until the labels + association-write scope are set up).
  const c = await getCase(db, id);
  if (c?.hubspot_deal_id) {
    const label = ONBOARDING_ROLES.find((r) => r.key === role)?.label ?? role;
    await associateDealContactRole(c.hubspot_deal_id, contactId, label).catch(() => {});
  }
  await logCaseEvent(db, id, "stakeholder_added", actorOf(me), { contact_id: contactId, role });
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}?step=stakeholders`);
}

export async function removeStakeholderAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  const sid = str(formData.get("stakeholder_id"));
  if (id && sid) {
    const db = serviceClient();
    await removeStakeholder(db, sid);
    await logCaseEvent(db, id, "stakeholder_removed", actorOf(me), { stakeholder_id: sid });
    revalidatePath(`/onboarding/${id}`);
  }
  redirect(`/onboarding/${id}?step=stakeholders`);
}

export async function setSandboxAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const required = str(formData.get("api_sandbox_required")) === "on";
  const db = serviceClient();
  await updateCase(db, id, { api_sandbox_required: required });
  await logCaseEvent(db, id, "sandbox_toggled", actorOf(me), { api_sandbox_required: required });
  revalidatePath(`/onboarding/${id}?step=finish`);
  redirect(`/onboarding/${id}?step=finish`);
}

/** Finish — mark the internal stage complete; fire the API-sandbox request if asked. */
export async function completeInternalAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) { await flash("error", "Case not found."); return redirect("/onboarding"); }

  const stakeholders = await listStakeholders(db, id);
  if (!readyToComplete(c, stakeholders.length)) {
    await flash("error", "Finish the company, products and stakeholders steps first.");
    return redirect(`/onboarding/${id}`);
  }

  await updateCase(db, id, { status: "internal_complete" });
  await logCaseEvent(db, id, "internal_complete", actorOf(me), { product_groups: c.product_groups });
  if (c.hubspot_deal_id) await syncDealOnboardingStatus(c.hubspot_deal_id, "internal_complete").catch(() => {});

  if (c.api_sandbox_required) {
    await requestApiSandbox(db, id).catch(() => {});
    await logCaseEvent(db, id, "api_sandbox_requested", actorOf(me), {});
  }

  await flash("success", "Internal onboarding complete. Merchant invite comes in Phase 3.");
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}`);
}

/** Phase 3 — invite the merchant to complete the public onboarding form. */
export async function inviteMerchantAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const emailOverride = str(formData.get("email")).toLowerCase();
  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) { await flash("error", "Case not found."); return redirect("/onboarding"); }

  // Merchant email: explicit override, else the authorised-signatory
  // stakeholder's contact email, else the first stakeholder's.
  let toEmail = emailOverride;
  let firstName: string | null = null;
  if (!toEmail) {
    const stakeholders = await listStakeholders(db, id);
    const sig = stakeholders.find((s) => s.role === "authorised_signatory") ?? stakeholders[0];
    if (sig) {
      const ct = await hubspotRepo.getContact(sig.hubspot_contact_id).catch(() => null);
      toEmail = (ct?.email ?? "").toLowerCase();
      firstName = ct?.full_name ? ct.full_name.split(/\s+/)[0]! : null;
    }
  }
  if (!toEmail) {
    await flash("error", "No merchant email — add an authorised signatory (step 3) or enter an email.");
    return redirect(`/onboarding/${id}?step=finish`);
  }

  try {
    await sendMerchantInvite(db, { token: c.merchant_form_token, toEmail, firstName });
    await updateCase(db, id, { status: "merchant_invited" });
    await logCaseEvent(db, id, "merchant_invited", actorOf(me), { to: toEmail });
    if (c.hubspot_deal_id) await syncDealOnboardingStatus(c.hubspot_deal_id, "merchant_invited").catch(() => {});
    await flash("success", `Merchant invite sent to ${toEmail}.`);
  } catch (e) {
    await flash("error", `Invite failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}`);
}

/** Phase 2b — fetch + parse the latest filed iXBRL accounts for a case. */
export async function parseAccountsAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const r = await parseAccountsForCase(db, id, actorOf(me));
    await flash("success", `Accounts parsed${r.period_end ? ` (to ${r.period_end})` : ""}.`);
  } catch (e) {
    await flash("error", (e as Error).message);
  }
  revalidatePath(`/onboarding/${id}/enrichment`);
  redirect(`/onboarding/${id}/enrichment`);
}

/** Phase 2 — run (or re-run) Companies House deep enrichment for a case. */
export async function enrichCaseAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const r = await enrichCompanyForCase(db, id, actorOf(me));
    await flash(
      "success",
      `Enriched: ${r.officers} officer(s), ${r.ubos} PSC/UBO node(s).` +
        (r.disqualifiedFound ? " ⚠ Possible disqualified-officer match — verify." : ""),
    );
  } catch (e) {
    await flash("error", `Enrichment failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}/enrichment`);
  redirect(`/onboarding/${id}/enrichment`);
}

/** Phase 3c — fetch + AI-assess the merchant's privacy policy. */
export async function assessPrivacyPolicyAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const r = await assessPrivacyPolicy(db, id, actorOf(me));
    await flash("success", `Privacy policy assessed: ${r.overall.replace(/_/g, " ")}.`);
  } catch (e) {
    await flash("error", `Assessment failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}/review`);
  redirect(`/onboarding/${id}/review`);
}

/** Phase 5 — generate the onboarding documents from the branded templates. */
export async function generateDocsAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const r = await generateDocsForCase(db, id, actorOf(me));
    await flash("success", `Generated ${r.generated} document${r.generated === 1 ? "" : "s"}.`);
  } catch (e) {
    await flash("error", `Document generation failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}/review`);
  redirect(`/onboarding/${id}/review`);
}

/** Phase 5c — file the case's documents + uploads into Google Drive. */
export async function fileToDriveAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const r = await fileCaseToDrive(db, id, actorOf(me));
    await flash("success", `Filed ${r.filed} file${r.filed === 1 ? "" : "s"} to Drive${r.createdFolders ? " (folder created)" : ""}.`);
  } catch (e) {
    await flash("error", `Drive filing failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}/review`);
  redirect(`/onboarding/${id}/review`);
}

/** Phase 5b — approve the onboarding (sign-off) → status onboarded. */
const APPROVABLE = new Set(["merchant_submitted", "ubo_checks", "docs_generated", "awaiting_approval"]);
export async function approveCaseAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) { await flash("error", "Case not found."); return redirect("/onboarding"); }
  if (c.status === "onboarded") { await flash("success", "Already onboarded."); return redirect(`/onboarding/${id}/review`); }
  if (!APPROVABLE.has(c.status)) {
    await flash("error", "The merchant form (and checks) need to be complete before approval.");
    return redirect(`/onboarding/${id}/review`);
  }
  await db.from("onboarding_cases").update({ status: "onboarded", approver_user_id: me.id, approved_at: new Date().toISOString() }).eq("id", id);
  await logCaseEvent(db, id, "approved", actorOf(me), {});
  if (c.hubspot_deal_id) await syncDealOnboardingStatus(c.hubspot_deal_id, "onboarded").catch(() => {});
  // Kick off billing: create the billing account + mirror line items + email the
  // deal owner. Best-effort inline; the daily reconcile cron backfills any miss.
  await ensureBillingForCase(db, c).catch((e) => console.error(`[billing] provision failed for case ${id}:`, e));
  await flash("success", "Onboarding approved — marked onboarded.");
  revalidatePath(`/onboarding/${id}/review`);
  redirect(`/onboarding/${id}/review`);
}

/** Phase 4 — run ID&V + PEP/sanctions screening for each beneficial owner. */
export async function runUboChecksAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const r = await runUboChecks(db, id, actorOf(me));
    const extra = [r.pepMatches ? `${r.pepMatches} PEP` : "", r.sanctionsMatches ? `${r.sanctionsMatches} sanctions` : ""].filter(Boolean).join(", ");
    await flash("success", `UBO checks: ${r.verified}/${r.checked} ID-verified${extra ? ` · ${extra} — verify the hit(s)` : ""}.`);
  } catch (e) {
    await flash("error", `UBO checks failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}/review`);
  redirect(`/onboarding/${id}/review`);
}

/** Phase 3c — AI-extract one uploaded document. */
export async function extractUploadAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  const uploadId = str(formData.get("upload_id"));
  if (id && uploadId) {
    await extractUpload(serviceClient(), uploadId).catch(() => {});
    revalidatePath(`/onboarding/${id}/review`);
  }
  redirect(`/onboarding/${id}/review`);
}

export async function cancelCaseAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (id) {
    const db = serviceClient();
    const c = await getCase(db, id);
    await updateCase(db, id, { status: "cancelled" });
    await logCaseEvent(db, id, "cancelled", actorOf(me), {});
    if (c?.hubspot_deal_id) await syncDealOnboardingStatus(c.hubspot_deal_id, "cancelled").catch(() => {});
    await flash("success", "Onboarding cancelled.");
  }
  redirect("/onboarding");
}
