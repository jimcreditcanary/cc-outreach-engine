// Phase 1 internal onboarding wizard. One case, four steps — Company (confirm
// via Companies House), Products (the 10-group catalog with auto-select rules),
// Stakeholders (deal contacts + roles), Finish (API-sandbox toggle + complete).
// Each step posts a server action that persists + advances. Merchant invite,
// CH deep enrichment, UBO checks and docs are later phases.

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { hubspotEnabled } from "@/lib/hubspot/client";
import { getDeal, dealContactIds, hubspotRepo } from "@/lib/hubspot/repo";
import { getCompaniesHouse } from "@/lib/integrations/companiesHouse";
import { fmtDate } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import type { ContactRecord } from "@/lib/crm/types";
import {
  getCase, listStakeholders, stepStatus, firstIncompleteStep, readyToComplete,
  WIZARD_STEPS, ONBOARDING_ROLES, type WizardStepId, type OnboardingCase, type Stakeholder,
} from "@/lib/onboarding/cases";
import {
  PRODUCT_GROUPS, PRODUCT_GROUP_KEYS, lockedSelections,
  isLightTouch, requiresFullKyc, requiresTuSection, requiresPayments,
  requiresDirectDebit, requiresFcaFrn, documentsFor, type OnboardingDocKind,
} from "@/lib/onboarding/productGroups";
import {
  saveCompanyAction, saveProductsAction, addStakeholderAction, removeStakeholderAction,
  setSandboxAction, completeInternalAction, cancelCaseAction, inviteMerchantAction,
} from "../actions";
import { merchantFormUrl } from "@/lib/onboarding/merchantForm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const DOC_LABELS: Record<OnboardingDocKind, string> = {
  tu_credit_eua: "TU Credit EUA",
  tu_monevo_eua: "TU Monevo EUA",
  tu_due_diligence_xlsx: "TU Due Diligence (xlsx)",
  merchant_onboarding_form: "Merchant Onboarding Form",
  dd_questionnaire: "DD Questionnaire",
};

export default async function CaseWizardPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; q?: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;
  const sp = await searchParams;

  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) notFound();

  const stakeholders = await listStakeholders(db, id);
  const deal = c.hubspot_deal_id ? await getDeal(c.hubspot_deal_id) : null;
  const done = stepStatus(c, stakeholders.length);

  const validStep = (s: string | undefined): s is WizardStepId =>
    !!s && WIZARD_STEPS.some((w) => w.id === s);
  const step: WizardStepId = validStep(sp.step) ? sp.step : firstIncompleteStep(c, stakeholders.length);
  const locked = c.status !== "started" && c.status !== "internal_complete";

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href="/onboarding" className="text-sm text-blue-700 hover:underline">← Onboarding</Link>

      <header className="mb-4 mt-2 border-b border-neutral-200 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-xl font-semibold">{deal?.name || "Onboarding case"}</h1>
          <StatusBadge status={c.status} />
          {deal?.url && <a href={deal.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">deal in HubSpot ↗</a>}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {c.company_number ? `Company ${c.company_number}` : "No company confirmed yet"}
          {" · "}{c.product_groups.length} product group{c.product_groups.length === 1 ? "" : "s"}
          {" · "}{stakeholders.length} stakeholder{stakeholders.length === 1 ? "" : "s"}
        </p>
      </header>

      {/* Step indicator */}
      <nav className="mb-6 flex flex-wrap gap-1">
        {WIZARD_STEPS.map((w) => {
          const active = w.id === step;
          const complete = done[w.id];
          return (
            <Link
              key={w.id}
              href={`/onboarding/${id}?step=${w.id}`}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${
                active ? "bg-amber-600 text-white"
                : complete ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${active ? "bg-white/25" : complete ? "bg-emerald-200 text-emerald-900" : "bg-neutral-300 text-neutral-700"}`}>
                {complete ? "✓" : w.n}
              </span>
              {w.label}
            </Link>
          );
        })}
      </nav>

      {step === "company" && <CompanyStep c={c} deal={deal} q={sp.q} />}
      {step === "products" && <ProductsStep c={c} />}
      {step === "stakeholders" && <StakeholdersStep c={c} stakeholders={stakeholders} />}
      {step === "finish" && <FinishStep c={c} stakeholders={stakeholders} locked={locked} />}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "onboarded" ? "bg-emerald-100 text-emerald-800"
    : status === "cancelled" ? "bg-neutral-200 text-neutral-600"
    : status === "started" ? "bg-amber-100 text-amber-800"
    : "bg-blue-100 text-blue-800";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

// ─── Step 1: Company ─────────────────────────────────────────────────────────────

async function CompanyStep({ c, deal, q }: { c: OnboardingCase; deal: { name: string | null } | null; q?: string }) {
  const query = (q ?? "").trim();
  const results = query ? await getCompaniesHouse().searchCompanies(query, 10) : [];

  return (
    <section className="max-w-2xl">
      <h2 className="mb-1 font-semibold">Confirm the company</h2>
      <p className="mb-3 text-sm text-neutral-500">Search Companies House and pick the legal entity behind this deal. Deep enrichment (officers, PSCs, accounts) comes in the next phase.</p>

      {c.company_number && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
          <span className="text-emerald-800">✓ Confirmed: company number <strong>{c.company_number}</strong></span>
          <Link href={`/onboarding/${c.id}/enrichment`} className="ml-auto text-blue-700 hover:underline">Companies House enrichment →</Link>
          <Link href={`/onboarding/${c.id}?step=products`} className="text-blue-700 hover:underline">Next: products →</Link>
        </div>
      )}

      <form method="get" className="mb-4 flex gap-2">
        <input type="hidden" name="step" value="company" />
        <input name="q" defaultValue={query || deal?.name || ""} placeholder="Company name or number…" className={field} />
        <button className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">Search</button>
      </form>

      {query && results.length === 0 && <p className="text-sm text-neutral-400">No matches for “{query}”.</p>}
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.company_number} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-neutral-800">{r.title}</div>
              <div className="text-xs text-neutral-500">
                {r.company_number}{r.company_status ? ` · ${r.company_status}` : ""}{r.address_snippet ? ` · ${r.address_snippet}` : ""}
              </div>
            </div>
            <form action={saveCompanyAction}>
              <input type="hidden" name="case_id" value={c.id} />
              <input type="hidden" name="company_number" value={r.company_number} />
              <PendingButton
                className={`rounded px-3 py-1.5 text-xs font-medium ${c.company_number === r.company_number ? "border border-emerald-300 text-emerald-700" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                pendingLabel="Saving…"
              >
                {c.company_number === r.company_number ? "Selected" : "Use this company"}
              </PendingButton>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Step 2: Products ────────────────────────────────────────────────────────────

function ProductsStep({ c }: { c: OnboardingCase }) {
  const selected = new Set(c.product_groups);
  const locked = lockedSelections(c.product_groups);
  return (
    <section className="max-w-2xl">
      <h2 className="mb-1 font-semibold">Product groups</h2>
      <p className="mb-3 text-sm text-neutral-500">
        What are they being onboarded for? Selecting <strong>Settlement Accounts</strong> includes Faster Payments. Any “full” product triggers the full KYC path; Open Banking and Confirmation of Payee alone take the light-touch path (basic Companies House check only).
      </p>
      <form action={saveProductsAction} className="space-y-2">
        <input type="hidden" name="case_id" value={c.id} />
        {PRODUCT_GROUP_KEYS.map((k) => {
          const g = PRODUCT_GROUPS[k];
          const isLocked = locked.has(k);
          const checked = selected.has(k) || isLocked;
          return (
            <label key={k} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2.5 text-sm">
              <input type="checkbox" name="groups" value={k} defaultChecked={checked} className="h-4 w-4" />
              <span className="font-medium text-neutral-800">{g.label}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${g.weight === "full" ? "bg-blue-100 text-blue-700" : "bg-neutral-100 text-neutral-500"}`}>{g.weight}</span>
              {g.autoSelects?.length ? <span className="text-xs text-neutral-400">includes {g.autoSelects.map((a) => PRODUCT_GROUPS[a].label).join(", ")}</span> : null}
              {isLocked && <span className="ml-auto text-xs text-neutral-400">auto-included</span>}
            </label>
          );
        })}
        <div className="pt-2">
          <PendingButton className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700" pendingLabel="Saving…">
            Save &amp; continue →
          </PendingButton>
        </div>
      </form>
    </section>
  );
}

// ─── Step 3: Stakeholders ────────────────────────────────────────────────────────

async function StakeholdersStep({ c, stakeholders }: { c: OnboardingCase; stakeholders: Stakeholder[] }) {
  // Deal contacts populate the picker; we also resolve stakeholder names.
  const dealContactIdList = c.hubspot_deal_id && hubspotEnabled() ? await dealContactIds(c.hubspot_deal_id) : [];
  const neededIds = [...new Set([...dealContactIdList, ...stakeholders.map((s) => s.hubspot_contact_id)])];
  const contacts = await Promise.all(neededIds.map((cid) => hubspotRepo.getContact(cid).catch(() => null)));
  const byId = new Map<string, ContactRecord>();
  for (const ct of contacts) if (ct) byId.set(ct.id, ct);
  const dealContacts = dealContactIdList.map((cid) => byId.get(cid)).filter((x): x is ContactRecord => !!x);
  const roleLabel = (r: string) => ONBOARDING_ROLES.find((x) => x.key === r)?.label ?? r;

  return (
    <section className="max-w-2xl">
      <h2 className="mb-1 font-semibold">Stakeholders &amp; roles</h2>
      <p className="mb-3 text-sm text-neutral-500">Who are we dealing with on this onboarding? Add the deal&apos;s contacts and tag each with their role.</p>

      {stakeholders.length === 0 ? (
        <p className="mb-4 text-sm text-neutral-400">No stakeholders yet.</p>
      ) : (
        <ul className="mb-4 space-y-2">
          {stakeholders.map((s) => {
            const ct = byId.get(s.hubspot_contact_id);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2.5 text-sm">
                <span className="font-medium text-neutral-800">{ct?.full_name || s.hubspot_contact_id}</span>
                {ct?.job_title && <span className="text-xs text-neutral-400">{ct.job_title}</span>}
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{roleLabel(s.role)}</span>
                <form action={removeStakeholderAction} className="ml-auto">
                  <input type="hidden" name="case_id" value={c.id} />
                  <input type="hidden" name="stakeholder_id" value={s.id} />
                  <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100" pendingLabel="…">Remove</PendingButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {dealContacts.length === 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No contacts associated with this deal in HubSpot — add them on the deal in HubSpot, then they&apos;ll appear here.
        </p>
      ) : (
        <form action={addStakeholderAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <input type="hidden" name="case_id" value={c.id} />
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Contact</label>
            <select name="contact_id" className={field} defaultValue="">
              <option value="" disabled>Pick a contact…</option>
              {dealContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.full_name}{ct.job_title ? ` — ${ct.job_title}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Role</label>
            <select name="role" className={field} defaultValue="">
              <option value="" disabled>Role…</option>
              {ONBOARDING_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Adding…">+ Add</PendingButton>
        </form>
      )}

      <div className="mt-4">
        <Link href={`/onboarding/${c.id}?step=finish`} className="text-sm text-blue-700 hover:underline">Next: finish →</Link>
      </div>
    </section>
  );
}

// ─── Step 4: Finish ──────────────────────────────────────────────────────────────

function FinishStep({ c, stakeholders, locked }: { c: OnboardingCase; stakeholders: Stakeholder[]; locked: boolean }) {
  const groups = c.product_groups;
  const ready = readyToComplete(c, stakeholders.length);
  const weight = isLightTouch(groups) ? "light-touch" : requiresFullKyc(groups) ? "full KYC" : "—";
  const checks: string[] = [];
  if (requiresTuSection(groups)) checks.push("TU due-diligence + infosec");
  if (requiresPayments(groups)) checks.push("Payment / disbursal details");
  if (requiresDirectDebit(groups)) checks.push("Direct Debit sub-form");
  if (requiresFcaFrn(groups)) checks.push("FCA FRN (required)");
  if (requiresFullKyc(groups)) checks.push("UBO chain + ID&V + PEP");
  const docs = documentsFor(groups);

  const alreadyComplete = c.status !== "started";

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <h2 className="mb-1 font-semibold">Review &amp; finish</h2>
        <p className="text-sm text-neutral-500">What the selection implies downstream (built out in the next phases):</p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Summary label="Company">{c.company_number ?? <span className="text-neutral-400">not set</span>}</Summary>
        <Summary label="Path">{weight}</Summary>
        <Summary label="Product groups">{groups.length ? groups.map((g) => PRODUCT_GROUPS[g as keyof typeof PRODUCT_GROUPS]?.label ?? g).join(", ") : <span className="text-neutral-400">none</span>}</Summary>
        <Summary label="Stakeholders">{stakeholders.length}</Summary>
        <Summary label="Checks triggered">{checks.length ? checks.join(" · ") : <span className="text-neutral-400">basic CH check only</span>}</Summary>
        <Summary label="Documents">{docs.length ? docs.map((d) => DOC_LABELS[d]).join(", ") : <span className="text-neutral-400">none</span>}</Summary>
      </dl>

      {/* API sandbox toggle */}
      <form action={setSandboxAction} className="rounded-lg border border-neutral-200 bg-white p-3">
        <input type="hidden" name="case_id" value={c.id} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="api_sandbox_required" defaultChecked={c.api_sandbox_required} className="h-4 w-4" />
          <span className="font-medium text-neutral-800">API sandbox access required</span>
        </label>
        <p className="mt-1 text-xs text-neutral-500">On completing internal onboarding, this fires a request to set them up with API sandbox access.</p>
        <div className="mt-2">
          <PendingButton className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Saving…">Save toggle</PendingButton>
        </div>
      </form>

      {alreadyComplete ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm text-emerald-800">
          ✓ Internal onboarding marked <strong>{c.status.replace(/_/g, " ")}</strong>.
        </div>
      ) : (
        <form action={completeInternalAction}>
          <input type="hidden" name="case_id" value={c.id} />
          <PendingButton
            className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
            pendingLabel="Completing…"
            disabled={!ready}
          >
            ✓ Complete internal onboarding
          </PendingButton>
          {!ready && <p className="mt-1 text-xs text-neutral-500">Finish the company, products and stakeholders steps first.</p>}
        </form>
      )}

      {(c.status === "internal_complete" || c.status.startsWith("merchant")) && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="mb-1 font-semibold text-neutral-800">Merchant form</h3>
          {c.status === "internal_complete" ? (
            <>
              <p className="mb-2 text-sm text-neutral-500">Invite the merchant to confirm their business details + ownership. Goes to the authorised signatory, or enter an email.</p>
              <form action={inviteMerchantAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="case_id" value={c.id} />
                <input name="email" type="email" placeholder="merchant@company.com (optional)" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
                <PendingButton className="rounded bg-[#003566] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#002a52]" pendingLabel="Sending…">Invite merchant →</PendingButton>
              </form>
            </>
          ) : (
            <div className="text-sm">
              <p className="text-neutral-700">Status: <strong>{c.status.replace(/_/g, " ")}</strong></p>
              <p className="mt-1 break-all text-xs text-neutral-500">
                Form link: <a href={merchantFormUrl(c.merchant_form_token)} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{merchantFormUrl(c.merchant_form_token)}</a>
              </p>
              <Link href={`/onboarding/${c.id}/review`} className="mt-1 inline-block text-blue-700 hover:underline">Review submission →</Link>
              {(c.status === "merchant_invited" || c.status === "merchant_in_progress") && (
                <form action={inviteMerchantAction} className="mt-2">
                  <input type="hidden" name="case_id" value={c.id} />
                  <PendingButton className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100" pendingLabel="…">Resend invite</PendingButton>
                </form>
              )}
            </div>
          )}
        </section>
      )}

      {!locked && (
        <form action={cancelCaseAction} className="pt-2">
          <input type="hidden" name="case_id" value={c.id} />
          <PendingButton className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50" pendingLabel="…">Cancel this onboarding</PendingButton>
        </form>
      )}
    </section>
  );
}

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-800">{children}</dd>
    </div>
  );
}
