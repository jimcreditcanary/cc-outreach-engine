// Onboarding case helpers — the DB layer for the Phase 1 internal wizard, plus
// the PURE step-progress logic (exported separately so it's unit-tested without
// a database). All DB access is server-side via serviceClient() (RLS bypass);
// migration 048 holds the tables.

import crypto from "node:crypto";
import type { serviceClient } from "../db/client";
import { normalizeSelection, type ProductGroupKey } from "./productGroups";

type DB = ReturnType<typeof serviceClient>;

export type OnboardingCaseStatus =
  | "started" | "internal_complete" | "merchant_invited" | "merchant_in_progress"
  | "merchant_submitted" | "ubo_checks" | "docs_generated" | "awaiting_approval"
  | "onboarded" | "cancelled";

export type OnboardingRole =
  | "authorised_signatory" | "economic_buyer" | "procurement"
  | "finance" | "compliance" | "technical_product";

export const ONBOARDING_ROLES: { key: OnboardingRole; label: string }[] = [
  { key: "authorised_signatory", label: "Authorised signatory" },
  { key: "economic_buyer", label: "Economic buyer" },
  { key: "procurement", label: "Procurement" },
  { key: "finance", label: "Finance" },
  { key: "compliance", label: "Compliance" },
  { key: "technical_product", label: "Technical / product" },
];

export function isOnboardingRole(v: string): v is OnboardingRole {
  return ONBOARDING_ROLES.some((r) => r.key === v);
}

export interface OnboardingCase {
  id: string;
  hubspot_deal_id: string | null;
  hubspot_company_id: string | null;
  company_number: string | null;
  status: OnboardingCaseStatus;
  product_groups: string[];
  api_sandbox_required: boolean;
  merchant_form_token: string;
  deal_owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stakeholder {
  id: string;
  case_id: string;
  hubspot_contact_id: string;
  role: OnboardingRole;
  created_at: string;
}

// ─── pure step-progress logic (unit-tested) ─────────────────────────────────────

export type WizardStepId = "company" | "products" | "stakeholders" | "finish";

export const WIZARD_STEPS: { id: WizardStepId; n: number; label: string }[] = [
  { id: "company", n: 1, label: "Company" },
  { id: "products", n: 2, label: "Products" },
  { id: "stakeholders", n: 3, label: "Stakeholders" },
  { id: "finish", n: 4, label: "Finish" },
];

/** Which steps are done, from the case + stakeholder count. Pure. */
export function stepStatus(c: Pick<OnboardingCase, "company_number" | "product_groups" | "status">, stakeholderCount: number): Record<WizardStepId, boolean> {
  return {
    company: !!c.company_number,
    products: (c.product_groups?.length ?? 0) > 0,
    stakeholders: stakeholderCount > 0,
    finish: c.status !== "started",
  };
}

/** The first step still to do — where the wizard should open. Pure. */
export function firstIncompleteStep(c: Pick<OnboardingCase, "company_number" | "product_groups" | "status">, stakeholderCount: number): WizardStepId {
  const done = stepStatus(c, stakeholderCount);
  return (WIZARD_STEPS.find((s) => !done[s.id])?.id) ?? "finish";
}

/** All of company + products + stakeholders done → ready to complete internal. Pure. */
export function readyToComplete(c: Pick<OnboardingCase, "company_number" | "product_groups" | "status">, stakeholderCount: number): boolean {
  const done = stepStatus(c, stakeholderCount);
  return done.company && done.products && done.stakeholders;
}

// ─── DB layer ───────────────────────────────────────────────────────────────────

const CASE_COLS = "id, hubspot_deal_id, hubspot_company_id, company_number, status, product_groups, api_sandbox_required, merchant_form_token, deal_owner_user_id, created_at, updated_at";

export async function logCaseEvent(
  db: DB, caseId: string, event: string,
  actor: { id?: string | null; email?: string | null },
  payload?: unknown,
): Promise<void> {
  try {
    await db.from("onboarding_events").insert({
      case_id: caseId, event,
      actor_user_id: actor.id ?? null, actor_email: actor.email ?? null,
      payload: payload ?? null,
    });
  } catch { /* audit is best-effort — never block the action */ }
}

export async function getCase(db: DB, id: string): Promise<OnboardingCase | null> {
  const { data } = await db.from("onboarding_cases").select(CASE_COLS).eq("id", id).maybeSingle();
  return (data as OnboardingCase | null) ?? null;
}

/** The live (non-cancelled) case for a deal, if any — used to dedupe "Start
 *  onboarding" and the closedwon auto-create. */
export async function liveCaseForDeal(db: DB, dealId: string): Promise<OnboardingCase | null> {
  const { data } = await db
    .from("onboarding_cases")
    .select(CASE_COLS)
    .eq("hubspot_deal_id", dealId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as OnboardingCase | undefined) ?? null;
}

export interface CreateCaseInput {
  dealId: string;
  hubspotCompanyId?: string | null;
  companyNumber?: string | null;
  ownerUserId?: string | null;
  actor: { id?: string | null; email?: string | null };
}

/** True if ANY case exists for the deal (including cancelled) — so the
 *  closedwon auto-create cron never recreates a case the operator cancelled. */
export async function anyCaseForDeal(db: DB, dealId: string): Promise<boolean> {
  const { data } = await db.from("onboarding_cases").select("id").eq("hubspot_deal_id", dealId).limit(1);
  return (data ?? []).length > 0;
}

/** Find the live case for a deal or create one. Returns the case + whether it
 *  was just created. */
export async function findOrCreateCaseForDeal(db: DB, input: CreateCaseInput): Promise<{ case: OnboardingCase; created: boolean }> {
  const existing = await liveCaseForDeal(db, input.dealId);
  if (existing) return { case: existing, created: false };

  const token = crypto.randomBytes(24).toString("base64url");
  const { data, error } = await db
    .from("onboarding_cases")
    .insert({
      hubspot_deal_id: input.dealId,
      hubspot_company_id: input.hubspotCompanyId ?? null,
      company_number: input.companyNumber ?? null,
      deal_owner_user_id: input.ownerUserId ?? null,
      merchant_form_token: token,
    })
    .select(CASE_COLS)
    .single();
  if (error) throw error;
  const created = data as OnboardingCase;
  await logCaseEvent(db, created.id, "case_created", input.actor, { deal_id: input.dealId });
  return { case: created, created: true };
}

export async function updateCase(db: DB, id: string, patch: Partial<Pick<OnboardingCase, "company_number" | "hubspot_company_id" | "product_groups" | "api_sandbox_required" | "status">>): Promise<void> {
  const { error } = await db.from("onboarding_cases").update(patch).eq("id", id);
  if (error) throw error;
}

/** Set the product selection, applying the auto-select/lock rules. */
export async function setProductGroups(db: DB, id: string, keys: string[]): Promise<ProductGroupKey[]> {
  const normalized = normalizeSelection(keys);
  await updateCase(db, id, { product_groups: normalized });
  return normalized;
}

export async function listStakeholders(db: DB, caseId: string): Promise<Stakeholder[]> {
  const { data } = await db
    .from("onboarding_stakeholders")
    .select("id, case_id, hubspot_contact_id, role, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  return (data as Stakeholder[] | null) ?? [];
}

export async function addStakeholder(db: DB, caseId: string, contactId: string, role: OnboardingRole): Promise<void> {
  // unique(case_id, hubspot_contact_id, role) — ignore a duplicate add.
  await db
    .from("onboarding_stakeholders")
    .upsert({ case_id: caseId, hubspot_contact_id: contactId, role }, { onConflict: "case_id,hubspot_contact_id,role", ignoreDuplicates: true });
}

export async function removeStakeholder(db: DB, id: string): Promise<void> {
  await db.from("onboarding_stakeholders").delete().eq("id", id);
}
