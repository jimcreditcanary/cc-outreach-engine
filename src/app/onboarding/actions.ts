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
import { dealCompanyId, syncDealOnboardingStatus, associateDealContactRole, associateDealContact, hubspotRepo } from "@/lib/hubspot/repo";
import {
  findOrCreateCaseForDeal, getCase, updateCase, setProductGroups,
  addStakeholder, removeStakeholder, listStakeholders, logCaseEvent,
  readyToComplete, isOnboardingRole, ONBOARDING_ROLES,
} from "@/lib/onboarding/cases";
import { requestApiSandbox } from "@/lib/onboarding/notify";
import { enrichCompanyForCase } from "@/lib/onboarding/enrich";
import { assessPrivacyPolicy } from "@/lib/onboarding/privacyAssessment";
import { extractUpload } from "@/lib/onboarding/uploads";
import { runUboChecks } from "@/lib/onboarding/uboChecks";
import { ensureUboDocRequest } from "@/lib/onboarding/uboDocs";
import { generateDocsForCase } from "@/lib/onboarding/docgen";
import { createShare, revokeShare } from "@/lib/onboarding/shares";
import { sendOnboardingWebhook } from "@/lib/onboarding/export";
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
  // Multi-select: one contact can take several roles in one go (a contact can
  // hold multiple roles; the stakeholder table is unique per case+contact+role).
  const roles = formData.getAll("roles").map((v) => String(v)).filter(isOnboardingRole);
  if (!id) return redirect("/onboarding");
  if (!contactId || roles.length === 0) {
    await flash("error", "Pick a contact and at least one role.");
    return redirect(`/onboarding/${id}?step=stakeholders`);
  }
  const db = serviceClient();
  for (const role of roles) await addStakeholder(db, id, contactId, role);
  // Mirror each role to HubSpot as a labeled deal↔contact association (best-effort;
  // no-ops until the labels + association-write scope are set up).
  const c = await getCase(db, id);
  if (c?.hubspot_deal_id) {
    for (const role of roles) {
      const label = ONBOARDING_ROLES.find((r) => r.key === role)?.label ?? role;
      await associateDealContactRole(c.hubspot_deal_id, contactId, label).catch(() => {});
    }
  }
  await logCaseEvent(db, id, "stakeholder_added", actorOf(me), { contact_id: contactId, roles });
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}?step=stakeholders`);
}

/** Stakeholders step — run (or refresh) Companies House enrichment and stay on
 *  the step so the pulled directors + UBOs render inline. */
export async function pullOfficersUbosAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const r = await enrichCompanyForCase(db, id, actorOf(me));
    await flash("success", `Pulled ${r.officers} officer(s) and ${r.ubos} UBO node(s) from Companies House.`);
  } catch (e) {
    await flash("error", `Companies House pull failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}?step=stakeholders`);
}

/** Create a brand-new contact on the case's company (and associate it to the
 *  deal so it's immediately pickable as a stakeholder). Saves a trip to HubSpot. */
export async function addContactToCompanyAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c?.hubspot_company_id) {
    await flash("error", "Confirm the company first, then add contacts.");
    return redirect(`/onboarding/${id}?step=stakeholders`);
  }
  const first = str(formData.get("first_name"));
  const last = str(formData.get("last_name"));
  const email = str(formData.get("email"));
  const jobTitle = str(formData.get("job_title"));
  const mobile = str(formData.get("mobile"));
  const linkedin = str(formData.get("linkedin"));
  if (!first && !email) {
    await flash("error", "Enter at least a name or email for the new contact.");
    return redirect(`/onboarding/${id}?step=stakeholders`);
  }
  const created = await hubspotRepo.createContact({
    first_name: first,
    last_name: last,
    email: email ?? undefined,
    job_title: jobTitle,
    mobile: mobile || undefined,
    company_id: c.hubspot_company_id,
  });
  // LinkedIn goes to a custom contact property (`linkedin_url`) that may not
  // exist until `npm run onboarding-setup-props` has run — write it best-effort
  // so a missing property never blocks contact creation.
  if (linkedin) {
    await hubspotRepo.updateContact(created.id, { linkedin }).catch((e) =>
      console.warn(`[onboarding] LinkedIn not saved for contact ${created.id} (property missing? run onboarding-setup-props):`, (e as Error).message),
    );
  }
  // Also link to the deal so it shows in the stakeholder picker (best-effort).
  if (c.hubspot_deal_id) await associateDealContact(c.hubspot_deal_id, created.id).catch(() => {});
  await logCaseEvent(db, id, "contact_created", actorOf(me), { contact_id: created.id, email });
  await flash("success", "Contact added.");
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

/** Finish — complete internal onboarding (feedback item 7a): generate the
 *  document pack (item 6) and make the customer onboarding link live. No email
 *  is ever sent to the customer — the salesperson shares the link. Folds in the
 *  API-sandbox toggle (the separate "Save toggle" button is gone). */
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

  // API-sandbox toggle folded into this action (no separate Save button).
  const sandbox = str(formData.get("api_sandbox_required")) === "on";
  await updateCase(db, id, { api_sandbox_required: sandbox });

  // Generate the onboarding document pack now (item 6), decoupled from the late
  // docs_generated status so it doesn't skip the customer step.
  // Generate only the internal documents now — the Merchant Onboarding Form (and
  // DD questionnaire) are held back until the customer submits the link (item 2).
  let docsMsg = "";
  try {
    const r = await generateDocsForCase(db, id, actorOf(me), { advanceStatus: false });
    docsMsg = r.generated > 0 ? ` · ${r.generated} internal document${r.generated === 1 ? "" : "s"} generated` : "";
  } catch (e) {
    docsMsg = ` · documents not generated (${(e as Error).message})`;
  }

  // Internal complete → the customer onboarding link is now live. The merchant
  // form advances itself to in-progress / submitted as the customer uses it.
  await updateCase(db, id, { status: "merchant_invited" });
  await logCaseEvent(db, id, "internal_complete", actorOf(me), { product_groups: c.product_groups, sandbox });
  await logCaseEvent(db, id, "customer_link_ready", actorOf(me), {});
  if (c.hubspot_deal_id) await syncDealOnboardingStatus(c.hubspot_deal_id, "merchant_invited").catch(() => {});

  if (sandbox) {
    await requestApiSandbox(db, id).catch(() => {});
    await logCaseEvent(db, id, "api_sandbox_requested", actorOf(me), {});
  }

  await flash("success", `Internal onboarding complete — share the customer link below${docsMsg}.`);
  revalidatePath(`/onboarding/${id}`);
  redirect(`/onboarding/${id}?step=finish`);
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

/** Mark (or clear) a beneficial owner's KYC documents as checked & validated. */
export async function setUboValidationAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  const kycId = str(formData.get("kyc_id"));
  const checked = str(formData.get("checked")) === "1";
  // The reviewer selects who validated from a dropdown of users; fall back to the
  // signed-in user's email if none chosen.
  const validatedBy = str(formData.get("validated_by")) || me.email || null;
  if (!id || !kycId) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const { error } = await db.from("onboarding_ubo_kyc")
      .update({ documents_checked_at: checked ? new Date().toISOString() : null, documents_checked_by: checked ? validatedBy : null })
      .eq("id", kycId).eq("case_id", id);
    if (error) throw error;
    await logCaseEvent(db, id, checked ? "ubo_docs_validated" : "ubo_docs_unvalidated", actorOf(me), { kyc_id: kycId });
  } catch (e) {
    const msg = (e as Error).message;
    await flash("error", `Couldn't update validation: ${msg}${/documents_checked|column/.test(msg) ? " — has migration 077 been applied?" : ""}`);
  }
  revalidatePath(`/onboarding/${id}/review`);
  redirect(`/onboarding/${id}/review`);
}

/** Create a third-party share link for the case's review. */
export async function createShareAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  if (!id) return redirect("/onboarding");
  const db = serviceClient();
  try {
    const share = await createShare(db, id, me.email ?? null, str(formData.get("label")) || null);
    if (share) {
      await logCaseEvent(db, id, "share_created", actorOf(me), { token: share.token });
      await flash("success", "Share link created — copy it below to send to the third party.");
    } else {
      await flash("error", "Could not create the share link (has migration 076 been applied?).");
    }
  } catch (e) {
    await flash("error", `Share link failed: ${(e as Error).message}`);
  }
  revalidatePath(`/onboarding/${id}/review`);
  redirect(`/onboarding/${id}/review`);
}

/** Revoke a share link (access is refused immediately). */
export async function revokeShareAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  const shareId = str(formData.get("share_id"));
  if (!id || !shareId) return redirect("/onboarding");
  const db = serviceClient();
  await revokeShare(db, id, shareId);
  await logCaseEvent(db, id, "share_revoked", actorOf(me), { share_id: shareId });
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
  // Push the config-only onboarding block to the dev-setup webhook, if configured.
  await sendOnboardingWebhook(db, id).catch(() => {});
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

/** Step 7 — open (or re-use) a UBO document-upload request so ops can share the
 *  link with a beneficial owner. No email — the link is copied + sent by hand. */
export async function requestUboDocsAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const id = str(formData.get("case_id"));
  const uboName = str(formData.get("ubo_name"));
  if (id && uboName) {
    await ensureUboDocRequest(serviceClient(), id, { uboName, reason: "manual request" }).catch(() => {});
    revalidatePath(`/onboarding/${id}/review`);
  }
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
